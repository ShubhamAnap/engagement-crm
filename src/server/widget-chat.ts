import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { buildPlaceholderAiReply } from "@/lib/chat-replies";
import { isWidgetOriginAllowed, normalizeWidgetHost } from "@/lib/widget-origins";
import { generateOpenAiReply } from "@/server/openai";
import { agentReplyConfig, resolveAgentStack } from "@/server/agents";
import { resolveAgentToolKeys } from "@/server/ai-tools";
import { buildAnswerInspector } from "@/server/answer-inspector";
import { isOffTopicMessage, isAckOnlyMessage, isGreetingOnlyMessage } from "@/lib/enertech-scope";
import {
  wantsHumanHandoff,
  isServiceIntent,
  emptyServiceTicket,
  mergeServiceTicketFromText,
  nextServiceTicketPrompt,
  explicitLanguageRequest,
  languageSwitchAck,
  type ServiceTicket,
} from "@/lib/conversation-guards";
import {
  greetingReplyForLang,
  offTopicReplyForLang,
  referencePhotosReplyForLang,
  kbPendingSendReplyForLang,
  normalizeStoredLang,
  sessionLangFromHistory,
  humanWaitReplyForLang,
} from "@/lib/session-language";
import { findReferenceImages, resolveCatalogueRequest, retrieveKnowledgeContext, wantsReferenceImages, customerAskedForMorePhotos } from "@/server/knowledge";
import {
  resolveProductPackRequest,
  buildProductPackMedia,
  buildProductsContextForAi,
  toCarouselCards,
  loadActiveProductById,
} from "@/server/product-pack";
import { formatProductPackBody, cleanProductDisplayName } from "@/lib/product-card";
import { normalizeWhatsAppDigits } from "@/lib/whatsapp-window";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

const visitorSchema = z.object({
  key: z.string().min(1),
  sessionId: z.string().min(8),
  pageOrigin: z.string().max(500).optional(),
  visitorName: z.string().optional(),
  visitorEmail: z.string().optional(),
  visitorPhone: z.string().optional(),
  visitorCompany: z.string().optional(),
  visitorLocation: z.string().optional(),
});

type VisitorFields = {
  visitorName?: string;
  visitorEmail?: string;
  visitorPhone?: string;
  visitorCompany?: string;
  visitorLocation?: string;
};

function assertWidgetKey(key: string) {
  const expected = process.env.WIDGET_PUBLIC_KEY || process.env.VITE_WIDGET_PUBLIC_KEY;
  if (!expected) {
    throw new Error("WIDGET_PUBLIC_KEY is not configured on the server");
  }
  if (!key || key !== expected) {
    throw new Error("Invalid widget key");
  }
}

async function assertWidgetPageOrigin(pageOrigin: string | null | undefined) {
  const supabase = createServiceSupabase();
  const { data: channel, error } = await supabase
    .from("channels")
    .select("config")
    .eq("org_id", ORG_ID)
    .eq("type", "website")
    .maybeSingle();
  if (error) throw new Error(error.message);

  const raw = channel?.config && typeof channel.config === "object" ? channel.config : {};
  const list = Array.isArray((raw as { allowed_origins?: unknown }).allowed_origins)
    ? ((raw as { allowed_origins: unknown[] }).allowed_origins
        .map((v) => normalizeWidgetHost(String(v)))
        .filter(Boolean) as string[])
    : [];

  const extra: string[] = [];
  for (const envName of ["VITE_APP_URL", "APP_URL"] as const) {
    const value = process.env[envName];
    const host = normalizeWidgetHost(value);
    if (host) extra.push(host);
  }

  if (
    !isWidgetOriginAllowed({
      pageOrigin,
      allowedOrigins: list,
      extraAlwaysAllowedHosts: extra,
    })
  ) {
    throw new Error(
      "This website is not allowed to use the EnerTech chat widget. Ask EnerTech to add your domain under Channels ? Website.",
    );
  }
}

async function assertWidgetAccess(key: string, pageOrigin?: string | null) {
  assertWidgetKey(key);
  await assertWidgetPageOrigin(pageOrigin);
}

function normalizeVisitor(fields: VisitorFields) {
  const rawPhone = fields.visitorPhone?.trim() || null;
  // Store E.164-style digits (91… for Indian 10-digit mobiles) so WA templates / inbox match
  const waPhone = normalizeWhatsAppDigits(rawPhone);
  return {
    visitor_name: fields.visitorName?.trim() || null,
    visitor_email: fields.visitorEmail?.trim() || null,
    visitor_phone: waPhone || rawPhone,
    visitor_company: fields.visitorCompany?.trim() || null,
    visitor_location: fields.visitorLocation?.trim() || null,
  };
}

function withLocationMetadata(
  existing: Record<string, unknown> | null | undefined,
  location: string | null,
) {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  const existingLocation = typeof base.location === "string" ? base.location : null;
  const next = location || existingLocation;
  if (next) base.location = next;
  else delete base.location;
  return base;
}

function preferExisting(existing: string | null | undefined, incoming: string | null | undefined) {
  const current = existing?.trim();
  if (current && !isAnonymousVisitorName(current)) return current;
  const next = incoming?.trim();
  return next || null;
}

/** Prefer the form name so Inbox never sticks on "Website visitor". */
function preferContactName(existing: string | null | undefined, incoming: string | null | undefined) {
  const next = incoming?.trim();
  if (next && !isAnonymousVisitorName(next)) return next;
  const current = existing?.trim();
  if (current && !isAnonymousVisitorName(current)) return current;
  return next || current || null;
}

function isAnonymousVisitorName(name: string | null | undefined) {
  const n = (name || "").trim().toLowerCase();
  return !n || n === "website visitor" || n === "visitor";
}

/** Inbox + welcome only after real chatbot form details (name + phone + email). */
function hasWebsiteContactDetails(
  visitor: {
    visitor_name?: string | null;
    visitor_email?: string | null;
    visitor_phone?: string | null;
  },
  matched?: { name?: string | null; email?: string | null; phone?: string | null } | null,
) {
  const name = (visitor.visitor_name || matched?.name || "").trim();
  const email = (visitor.visitor_email || matched?.email || "").trim();
  const phoneDigits = (visitor.visitor_phone || matched?.phone || "").replace(/\D/g, "");
  return Boolean(!isAnonymousVisitorName(name) && email && phoneDigits.length >= 10);
}

async function findCustomerByEmailOrPhone(
  supabase: ReturnType<typeof createServiceSupabase>,
  email?: string | null,
  phone?: string | null,
) {
  const normalizedEmail = email?.trim().toLowerCase() || "";
  const normalizedPhone = phone?.trim() || "";

  if (normalizedEmail) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, email, phone, company, metadata")
      .eq("org_id", ORG_ID)
      .ilike("email", normalizedEmail)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;
  }

  if (normalizedPhone) {
    const waDigits = normalizeWhatsAppDigits(normalizedPhone) || normalizedPhone.replace(/\D/g, "");
    const variants = Array.from(
      new Set([normalizedPhone, waDigits, waDigits.length === 12 && waDigits.startsWith("91") ? waDigits.slice(2) : ""].filter(Boolean)),
    );
    for (const phone of variants) {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, email, phone, company, metadata")
        .eq("org_id", ORG_ID)
        .eq("phone", phone)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) return data;
    }
  }

  return null;
}

async function countConversationMessages(
  supabase: ReturnType<typeof createServiceSupabase>,
  conversationId: string,
) {
  const { count, error } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function findLatestOpenWebsiteConversation(
  supabase: ReturnType<typeof createServiceSupabase>,
  opts: { customerId?: string | null; email?: string | null; phone?: string | null; excludeId?: string | null },
) {
  const email = opts.email?.trim() || "";
  const phone = opts.phone?.trim() || "";

  async function query(filter: { column: string; value: string; ilike?: boolean }) {
    let q = supabase
      .from("conversations")
      .select("*")
      .eq("org_id", ORG_ID)
      .eq("channel", "website")
      .neq("status", "closed")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(1);

    q = filter.ilike ? q.ilike(filter.column, filter.value) : q.eq(filter.column, filter.value);
    if (opts.excludeId) q = q.neq("id", opts.excludeId);

    const { data, error } = await q.maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  if (opts.customerId) {
    const byCustomer = await query({ column: "customer_id", value: opts.customerId });
    if (byCustomer) return byCustomer;
  }
  if (email) {
    const byEmail = await query({ column: "visitor_email", value: email, ilike: true });
    if (byEmail) return byEmail;
  }
  if (phone) {
    const byPhone = await query({ column: "visitor_phone", value: phone });
    if (byPhone) return byPhone;
  }
  return null;
}

async function attachSessionAndSync(
  supabase: ReturnType<typeof createServiceSupabase>,
  conversation: {
    id: string;
    customer_id: string | null;
    lead_id: string | null;
    visitor_name: string | null;
    visitor_email: string | null;
    visitor_phone: string | null;
    visitor_company: string | null;
    metadata?: Record<string, unknown> | null;
  },
  data: z.infer<typeof visitorSchema>,
) {
  await supabase
    .from("conversations")
    .update({ widget_session_id: data.sessionId })
    .eq("id", conversation.id);

  await syncConversationIdentity(supabase, conversation, data);

  const { data: refreshed, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversation.id)
    .single();
  if (error) throw new Error(error.message);
  return refreshed;
}

async function getWebsiteChannelId(supabase: ReturnType<typeof createServiceSupabase>) {
  const { data, error } = await supabase
    .from("channels")
    .select("id")
    .eq("org_id", ORG_ID)
    .eq("type", "website")
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

async function getConversationMessages(
  supabase: ReturnType<typeof createServiceSupabase>,
  conversationId: string,
) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, sender, body, created_at, metadata, confidence, sources")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) throw new Error(error.message);
  return data ?? [];
}

function inferLeadLabel(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("quote") || t.includes("quotation") || t.includes("price") || t.includes("pricing")) return "Quotation request";
  if (t.includes("battery") || t.includes("runtime") || t.includes("backup")) return "Battery/runtime enquiry";
  if (t.includes("service") || t.includes("support") || t.includes("complaint")) return "Service/support request";
  if (t.includes("ups") || t.includes("kva")) return "UPS enquiry";
  return null;
}

function inferLeadScore(text: string): number {
  const t = text.toLowerCase();
  if (t.includes("quote") || t.includes("quotation") || t.includes("price")) return 78;
  if (t.includes("battery") || t.includes("runtime") || t.includes("backup")) return 68;
  if (t.includes("service") || t.includes("support") || t.includes("complaint")) return 64;
  return 55;
}

/** Same browser session remounts must not spam Meta; new session or 12h+ revisit may re-send. */
const WEBSITE_WELCOME_RESEND_MS = 12 * 60 * 60 * 1000;

function shouldSendWebsiteWelcome(
  meta: Record<string, unknown>,
  sessionId: string,
): boolean {
  const lastSession =
    typeof meta.website_welcome_session_id === "string" ? meta.website_welcome_session_id : "";
  const lastAtRaw =
    typeof meta.website_welcome_sent_at === "string"
      ? meta.website_welcome_sent_at
      : typeof meta.website_visitor_captured_at === "string"
        ? meta.website_visitor_captured_at
        : "";
  const lastAt = lastAtRaw ? Date.parse(lastAtRaw) : NaN;

  // No session stamp yet (incl. old once-ever captures) → allow this session to send
  if (!lastSession) return true;
  // Different browser/chat session → send again
  if (lastSession !== sessionId) return true;
  // Same session remount: only re-send after 12h (return visit with sticky localStorage)
  if (!Number.isFinite(lastAt)) return true;
  return Date.now() - lastAt >= WEBSITE_WELCOME_RESEND_MS;
}

async function syncConversationIdentity(
  supabase: ReturnType<typeof createServiceSupabase>,
  convo: {
    id: string;
    customer_id: string | null;
    lead_id: string | null;
    visitor_name: string | null;
    visitor_email: string | null;
    visitor_phone: string | null;
    visitor_company: string | null;
    metadata?: Record<string, unknown> | null;
  },
  fields: VisitorFields & { sessionId?: string },
  opts?: { treatAsFirstCapture?: boolean; formSubmit?: boolean },
) {
  const normalized = normalizeVisitor(fields);
  const sessionId = (fields.sessionId || "").trim();
  const priorMeta =
    convo.metadata && typeof convo.metadata === "object" ? { ...convo.metadata } : {};

  const updates = {
    visitor_name:
      preferContactName(convo.visitor_name, normalized.visitor_name) ||
      convo.visitor_name ||
      "Website visitor",
    visitor_email: normalized.visitor_email || convo.visitor_email,
    visitor_phone: normalized.visitor_phone || convo.visitor_phone,
    visitor_company: normalized.visitor_company || convo.visitor_company,
    metadata: withLocationMetadata(convo.metadata, normalized.visitor_location),
  };

  await supabase.from("conversations").update(updates).eq("id", convo.id);

  let customerId = convo.customer_id;
  if (!customerId && (updates.visitor_email || updates.visitor_phone)) {
    const existing = await findCustomerByEmailOrPhone(supabase, updates.visitor_email, updates.visitor_phone);
    if (existing) customerId = existing.id as string;
  }

  if (customerId) {
    const { data: customer } = await supabase
      .from("customers")
      .select("name, email, phone, company, metadata")
      .eq("id", customerId)
      .maybeSingle();

    await supabase
      .from("customers")
      .update({
        name: preferContactName(customer?.name, updates.visitor_name) || "Website visitor",
        email: preferExisting(customer?.email, updates.visitor_email),
        phone: preferExisting(customer?.phone, updates.visitor_phone),
        company: preferExisting(customer?.company, updates.visitor_company),
        metadata: withLocationMetadata(
          (customer?.metadata as Record<string, unknown> | null) ?? {},
          normalized.visitor_location,
        ),
      })
      .eq("id", customerId);

    if (!convo.customer_id) {
      await supabase.from("conversations").update({ customer_id: customerId }).eq("id", convo.id);
    }
  }

  let leadId = convo.lead_id;
  if (leadId) {
    const { data: lead } = await supabase
      .from("leads")
      .select("name, email, phone, company, metadata")
      .eq("id", leadId)
      .maybeSingle();

    await supabase
      .from("leads")
      .update({
        name: preferContactName(lead?.name, updates.visitor_name) || "Website visitor",
        email: preferExisting(lead?.email, updates.visitor_email),
        phone: preferExisting(lead?.phone, updates.visitor_phone),
        company: preferExisting(lead?.company, updates.visitor_company),
        customer_id: customerId || convo.customer_id,
        metadata: withLocationMetadata(
          (lead?.metadata as Record<string, unknown> | null) ?? {},
          normalized.visitor_location,
        ),
      })
      .eq("id", leadId);
  }

  // Contact form submitted (name + phone + email) → Inbox + welcome WhatsApp per session
  const shouldWelcome =
    hasWebsiteContactDetails(
      {
        visitor_name: updates.visitor_name,
        visitor_email: updates.visitor_email,
        visitor_phone: updates.visitor_phone,
      },
      null,
    ) &&
    Boolean(sessionId) &&
    shouldSendWebsiteWelcome(priorMeta, sessionId);

  if (shouldWelcome) {
    try {
      await ensureConversationLinks(
        supabase,
        {
          id: convo.id,
          customer_id: customerId || convo.customer_id,
          lead_id: leadId,
          visitor_name: updates.visitor_name,
          visitor_email: updates.visitor_email,
          visitor_phone: updates.visitor_phone,
          visitor_company: updates.visitor_company,
          metadata: updates.metadata,
          tags: null,
        },
        "Website chat contact form submitted",
      );

      const { data: linked } = await supabase
        .from("conversations")
        .select(
          "id, lead_id, customer_id, visitor_name, visitor_email, visitor_phone, visitor_company, metadata",
        )
        .eq("id", convo.id)
        .maybeSingle();

      leadId = (linked?.lead_id as string) || leadId;

      const sentAt = new Date().toISOString();
      const phoneForWa =
        normalizeWhatsAppDigits(
          (linked?.visitor_phone as string) || updates.visitor_phone,
        ) ||
        (linked?.visitor_phone as string) ||
        updates.visitor_phone;
      const displayName =
        preferContactName(
          (linked?.visitor_name as string) || null,
          updates.visitor_name,
        ) || "Customer";
      const nextMeta = {
        ...(((linked?.metadata as Record<string, unknown> | null) || updates.metadata || {}) as Record<
          string,
          unknown
        >),
        contact_form_submitted_at:
          typeof priorMeta.contact_form_submitted_at === "string"
            ? priorMeta.contact_form_submitted_at
            : sentAt,
        website_visitor_captured_at:
          typeof priorMeta.website_visitor_captured_at === "string"
            ? priorMeta.website_visitor_captured_at
            : sentAt,
        website_welcome_sent_at: sentAt,
        website_welcome_session_id: sessionId,
        inbox_visible: true,
      };
      const preview = `${displayName}${phoneForWa ? ` · ${phoneForWa}` : ""}`.slice(0, 160);

      await supabase
        .from("conversations")
        .update({
          metadata: nextMeta,
          visitor_name: displayName,
          visitor_phone: phoneForWa || updates.visitor_phone,
          visitor_email: updates.visitor_email,
          preview,
          last_message_at: sentAt,
          updated_at: sentAt,
          unread_count: 1,
        })
        .eq("id", convo.id);

      await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: convo.id,
        sender: "system",
        body: `Contact saved · ${displayName}${phoneForWa ? ` · ${phoneForWa}` : ""}.`,
        metadata: { website_visitor_captured: true, session_id: sessionId },
      });

      if (leadId) {
        await supabase
          .from("leads")
          .update({
            name: displayName,
            phone: phoneForWa || updates.visitor_phone,
            email: updates.visitor_email,
          })
          .eq("id", leadId);
      }
      const custId = (linked?.customer_id as string) || customerId || convo.customer_id;
      if (custId) {
        await supabase
          .from("customers")
          .update({
            name: displayName,
            phone: phoneForWa || updates.visitor_phone,
            email: updates.visitor_email,
          })
          .eq("id", custId);
      }

      const { runAutomations } = await import("@/server/automation-engine");
      const result = await runAutomations("website_visitor_captured", {
        conversationId: convo.id,
        leadId: leadId || null,
        source: "website",
        channel: "website",
        phone: phoneForWa,
        email: (linked?.visitor_email as string) || updates.visitor_email,
        leadName: displayName,
        company: (linked?.visitor_company as string) || updates.visitor_company,
        leadStatus: "New",
      });
      console.info("website_visitor_captured", {
        conversationId: convo.id,
        sessionId,
        phone: phoneForWa,
        name: displayName,
        ...result,
      });
    } catch (err) {
      console.error("website_visitor_captured automation", err);
    }
  }
}

async function ensureConversationLinks(
  supabase: ReturnType<typeof createServiceSupabase>,
  convo: {
    id: string;
    customer_id: string | null;
    lead_id: string | null;
    visitor_name: string | null;
    visitor_email: string | null;
    visitor_phone: string | null;
    visitor_company: string | null;
    metadata?: Record<string, unknown> | null;
    tags?: string[] | null;
  },
  latestMessage: string,
) {
  let customerId = convo.customer_id;
  let leadId = convo.lead_id;
  const location =
    typeof convo.metadata?.location === "string" ? convo.metadata.location : null;

  if (!customerId) {
    const existing = await findCustomerByEmailOrPhone(
      supabase,
      convo.visitor_email,
      convo.visitor_phone,
    );

    if (existing) {
      customerId = existing.id as string;
      await supabase
        .from("customers")
        .update({
          name: preferContactName(existing.name, convo.visitor_name) || "Website visitor",
          email: preferExisting(existing.email, convo.visitor_email),
          phone: preferExisting(existing.phone, convo.visitor_phone),
          company: preferExisting(existing.company, convo.visitor_company),
          metadata: withLocationMetadata(
            (existing.metadata as Record<string, unknown> | null) ?? { source: "website-chat" },
            location,
          ),
        })
        .eq("id", customerId);
    } else {
      const { data: customer, error: customerError } = await supabase
        .from("customers")
        .insert({
          org_id: ORG_ID,
          name: convo.visitor_name || "Website visitor",
          company: convo.visitor_company || null,
          email: convo.visitor_email || null,
          phone: convo.visitor_phone || null,
          notes: "Auto-created from website chat conversation.",
          metadata: withLocationMetadata({ source: "website-chat" }, location),
        })
        .select("id")
        .single();
      if (customerError) throw new Error(customerError.message);
      customerId = customer.id as string;
    }
  }

  const inferredLabel = inferLeadLabel(latestMessage);
  const inferredScore = inferLeadScore(latestMessage);

  if (!leadId) {
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert({
        org_id: ORG_ID,
        customer_id: customerId,
        external_ref: `LD-${Date.now().toString().slice(-6)}`,
        score: inferredScore,
        status: "New",
        priority: inferredScore >= 75 ? "High" : "Medium",
        source: "website",
        name: convo.visitor_name || "Website visitor",
        company: convo.visitor_company || null,
        phone: convo.visitor_phone || null,
        email: convo.visitor_email || null,
        product_label: inferredLabel,
        last_activity_at: new Date().toISOString(),
        metadata: withLocationMetadata({ source: "website-chat" }, location),
      })
      .select("id")
      .single();
    if (leadError) throw new Error(leadError.message);
    leadId = lead.id as string;
  } else {
    const { error: leadUpdateError } = await supabase
      .from("leads")
      .update({
        last_activity_at: new Date().toISOString(),
        ...(inferredLabel ? { product_label: inferredLabel } : {}),
      })
      .eq("id", leadId);
    if (leadUpdateError) throw new Error(leadUpdateError.message);
  }

  const tags = Array.from(new Set([...(convo.tags ?? []), "Lead", "Customer"]));
  const { error: convoUpdateError } = await supabase
    .from("conversations")
    .update({ customer_id: customerId, lead_id: leadId, tags })
    .eq("id", convo.id);
  if (convoUpdateError) throw new Error(convoUpdateError.message);
}

export const widgetGetOrCreateConversation = createServerFn({ method: "POST" })
  .validator(visitorSchema)
  .handler(async ({ data }) => {
    await assertWidgetAccess(data.key, data.pageOrigin);
    const supabase = createServiceSupabase();
    const visitor = normalizeVisitor(data);

    const { data: bySession, error: findError } = await supabase
      .from("conversations")
      .select("*")
      .eq("org_id", ORG_ID)
      .eq("widget_session_id", data.sessionId)
      .eq("channel", "website")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) throw new Error(findError.message);

    const matched = await findCustomerByEmailOrPhone(
      supabase,
      visitor.visitor_email,
      visitor.visitor_phone,
    );

    const hasContact = hasWebsiteContactDetails(visitor, matched);

    // Drop empty anonymous placeholders left from older builds (no Inbox noise).
    if (bySession && !hasContact) {
      const anonymous =
        isAnonymousVisitorName(bySession.visitor_name as string) &&
        !(bySession.visitor_phone as string | null)?.replace(/\D/g, "");
      if (anonymous) {
        const msgCount = await countConversationMessages(supabase, bySession.id);
        if (msgCount === 0) {
          await supabase.from("conversations").delete().eq("id", bySession.id);
        }
      }
    }

    // Do not create Inbox threads until chatbot contact form is submitted.
    if (!hasContact) {
      throw new Error("Please submit your name, email, and phone to start chat.");
    }

    const displayName =
      preferContactName(visitor.visitor_name, matched?.name as string | null) ||
      visitor.visitor_name ||
      "Customer";

    // Prefer the contact's latest open website conversation when identity is known.
    const contactConvo = await findLatestOpenWebsiteConversation(supabase, {
      customerId: matched?.id ?? null,
      email: visitor.visitor_email || matched?.email,
      phone: visitor.visitor_phone || matched?.phone,
      excludeId: null,
    });

    if (contactConvo) {
      if (bySession && bySession.id !== contactConvo.id) {
        const msgCount = await countConversationMessages(supabase, bySession.id);
        if (msgCount === 0) {
          await supabase.from("conversations").delete().eq("id", bySession.id);
        }
      }
      return attachSessionAndSync(supabase, contactConvo, data);
    }

    if (bySession) {
      return attachSessionAndSync(supabase, bySession, data);
    }

    const channelId = await getWebsiteChannelId(supabase);
    const nowIso = new Date().toISOString();
    const { data: created, error: createError } = await supabase
      .from("conversations")
      .insert({
        org_id: ORG_ID,
        channel_id: channelId,
        channel: "website",
        external_ref: `CV-${Date.now().toString().slice(-6)}`,
        status: "ai",
        assignee_label: "AI · Support Agent",
        visitor_name: displayName,
        visitor_email: visitor.visitor_email || matched?.email,
        visitor_phone: visitor.visitor_phone || matched?.phone,
        visitor_company: visitor.visitor_company || matched?.company,
        metadata: withLocationMetadata(
          { contact_form_submitted_at: nowIso, inbox_visible: true },
          visitor.visitor_location ||
            (typeof matched?.metadata?.location === "string" ? matched.metadata.location : null),
        ),
        customer_id: matched?.id ?? null,
        widget_session_id: data.sessionId,
        tags: ["Website", "Embed"],
        unread_count: 1,
        preview: displayName,
        last_message_at: nowIso,
        updated_at: nowIso,
      })
      .select("*")
      .single();

    if (createError) throw new Error(createError.message);

    await syncConversationIdentity(supabase, created, data, {
      treatAsFirstCapture: !matched && Boolean(visitor.visitor_phone),
      formSubmit: true,
    });
    const { data: refreshed, error: refreshError } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", created.id)
      .single();
    if (refreshError) throw new Error(refreshError.message);
    return refreshed;
  });

export const widgetLookupVisitor = createServerFn({ method: "POST" })
  .validator(
    z.object({
      key: z.string().min(1),
      pageOrigin: z.string().max(500).optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await assertWidgetAccess(data.key, data.pageOrigin);
    const supabase = createServiceSupabase();
    const customer = await findCustomerByEmailOrPhone(supabase, data.email, data.phone);
    if (!customer) return null;

    const location =
      customer.metadata && typeof customer.metadata === "object" && typeof (customer.metadata as { location?: unknown }).location === "string"
        ? (customer.metadata as { location: string }).location
        : "";

    return {
      id: customer.id as string,
      name: (customer.name as string) || "",
      email: (customer.email as string) || "",
      phone: (customer.phone as string) || "",
      company: (customer.company as string) || "",
      location,
    };
  });

export const widgetListMessages = createServerFn({ method: "POST" })
  .validator(
    z.object({
      key: z.string().min(1),
      pageOrigin: z.string().max(500).optional(),
      conversationId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    await assertWidgetAccess(data.key, data.pageOrigin);
    const supabase = createServiceSupabase();

    const { data: convo, error: convoError } = await supabase
      .from("conversations")
      .select("id, org_id")
      .eq("id", data.conversationId)
      .eq("org_id", ORG_ID)
      .maybeSingle();

    if (convoError) throw new Error(convoError.message);
    if (!convo) throw new Error("Conversation not found");

    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return messages ?? [];
  });

export const widgetSendMessage = createServerFn({ method: "POST" })
  .validator(
    z.object({
      key: z.string().min(1),
      pageOrigin: z.string().max(500).optional(),
      conversationId: z.string().uuid(),
      body: z.string().min(1).max(4000),
    }),
  )
  .handler(async ({ data }) => {
    await assertWidgetAccess(data.key, data.pageOrigin);
    const supabase = createServiceSupabase();
    const text = data.body.trim();

    const { data: convo, error: convoError } = await supabase
      .from("conversations")
      .select("id, status, visitor_name, visitor_email, visitor_phone, visitor_company, customer_id, lead_id, tags, metadata, agent_id, channel, unread_count")
      .eq("id", data.conversationId)
      .eq("org_id", ORG_ID)
      .maybeSingle();

    if (convoError) throw new Error(convoError.message);
    if (!convo) throw new Error("Conversation not found");

    const { error: customerErr } = await supabase.from("messages").insert({
      org_id: ORG_ID,
      conversation_id: data.conversationId,
      sender: "customer",
      body: text,
    });
    if (customerErr) throw new Error(customerErr.message);

    const unread = Number(convo.unread_count || 0) + 1;
    await supabase
      .from("conversations")
      .update({
        unread_count: unread,
        preview: text.slice(0, 160),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.conversationId);

    await ensureConversationLinks(supabase, convo, text);

    const escalate = wantsHumanHandoff(text);
    const aiPaused =
      convo.status === "human" ||
      convo.status === "escalated" ||
      convo.status === "resolved" ||
      convo.status === "closed";
    const prevMetaEarly =
      convo.metadata && typeof convo.metadata === "object"
        ? (convo.metadata as Record<string, unknown>)
        : {};

    const historyEarly = await getConversationMessages(supabase, data.conversationId);
    const sessionLang = sessionLangFromHistory(
      text,
      historyEarly,
      normalizeStoredLang(prevMetaEarly.preferred_lang),
    );
    if (prevMetaEarly.preferred_lang !== sessionLang) {
      prevMetaEarly.preferred_lang = sessionLang;
      await supabase
        .from("conversations")
        .update({ metadata: { ...prevMetaEarly, preferred_lang: sessionLang } })
        .eq("id", data.conversationId);
    }

    // Human takeover / escalated: save only ? except explicit language switch
    if (aiPaused) {
      const switchTo = explicitLanguageRequest(text);
      if ((convo.status === "human" || convo.status === "escalated") && switchTo) {
        const ack = languageSwitchAck(switchTo);
        await supabase
          .from("conversations")
          .update({
            metadata: { ...prevMetaEarly, preferred_lang: switchTo },
            preview: ack.slice(0, 160),
          })
          .eq("id", data.conversationId);
        await supabase.from("messages").insert({
          org_id: ORG_ID,
          conversation_id: data.conversationId,
          sender: "ai",
          body: ack,
          metadata: { language_ack: true, lang: switchTo },
        });
        return {
          messages: await getConversationMessages(supabase, data.conversationId),
          reply: ack,
          source: "fallback",
          aiPaused: true,
          status: convo.status,
        };
      }
      return {
        messages: historyEarly,
        reply: null,
        source: "paused",
        aiPaused: true,
        status: convo.status,
      };
    }

    if (escalate) {
      const wait = humanWaitReplyForLang(sessionLang);
      await supabase
        .from("conversations")
        .update({
          status: "escalated",
          assignee_label: "Human queue",
          preview: wait.slice(0, 160),
          metadata: { ...prevMetaEarly, preferred_lang: sessionLang },
        })
        .eq("id", data.conversationId);
      await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: data.conversationId,
        sender: "ai",
        body: wait,
        metadata: { handoff: true, human_like_wait: true, lang: sessionLang },
      });
      try {
        const { fireAutomations } = await import("@/server/automation-engine");
        fireAutomations("conversation_escalated", { conversationId: data.conversationId });
      } catch (err) {
        console.error("escalation automation", err);
      }
      return {
        messages: await getConversationMessages(supabase, data.conversationId),
        reply: wait,
        source: "fallback",
        aiPaused: true,
        status: "escalated",
      };
    }

    const history = historyEarly;
    const priorHistory =
      history[history.length - 1]?.sender === "customer" && history[history.length - 1]?.body === text
        ? history.slice(0, -1)
        : history;

    const prevMeta = { ...prevMetaEarly };

    if (isAckOnlyMessage(text)) {
      return {
        messages: await getConversationMessages(supabase, data.conversationId),
        reply: null,
        source: "fallback",
        aiPaused: false,
        status: convo.status,
      };
    }

    if (isGreetingOnlyMessage(text)) {
      const reply = greetingReplyForLang(sessionLang);
      await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: data.conversationId,
        sender: "ai",
        body: reply,
        metadata: { greeting: true },
      });
      await supabase
        .from("conversations")
        .update({
          preview: reply.slice(0, 160),
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.conversationId);
      return {
        messages: await getConversationMessages(supabase, data.conversationId),
        reply,
        source: "fallback",
        aiPaused: false,
        status: convo.status,
      };
    }

    const pendingCatalogue = Array.isArray(prevMeta.pending_catalogue_options)
      ? (prevMeta.pending_catalogue_options as Array<{
          documentId: string;
          label: string;
          title?: string;
          url?: string;
          fileName?: string;
        }>)
      : [];

    const pendingProducts = Array.isArray(prevMeta.pending_product_options)
      ? (prevMeta.pending_product_options as Array<{ id: string; name: string }>)
      : [];

    // Products: website → swipe carousel first; detail only after "I need this"
    const productPack = await resolveProductPackRequest(text, {
      pendingProducts,
      presentation: "carousel",
    });
    if (productPack.mode === "carousel") {
      const nextMeta: Record<string, unknown> = {
        ...prevMeta,
        pending_product_options: productPack.products.map((p) => ({
          id: p.id,
          name: cleanProductDisplayName(p.name),
        })),
      };
      await supabase.from("conversations").update({ metadata: nextMeta }).eq("id", data.conversationId);

      const cards = toCarouselCards(productPack.products);
      const reply = productPack.message;
      const inspector = buildAnswerInspector({
        chunks: [],
        replySource: "openai",
        model: "gpt-4o-mini",
        agentName: "EnerBot",
        channel: (convo.channel as string) || "website",
        visitorName: convo.visitor_name || "Website visitor",
        downloadCount: 0,
        memoryEnabled: true,
      });

      const { error: packErr } = await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: data.conversationId,
        sender: "ai",
        body: reply,
        confidence: inspector.confidence,
        sources: inspector.sources,
        metadata: {
          ...inspector.metadata,
          product_carousel: true,
          products: cards,
        },
      });
      if (packErr) throw new Error(packErr.message);

      await supabase
        .from("conversations")
        .update({
          preview: reply.slice(0, 160),
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.conversationId);

      return {
        messages: await getConversationMessages(supabase, data.conversationId),
        reply,
        source: "openai",
        aiPaused: false,
        status: convo.status,
      };
    }

    if (productPack.mode === "clarify" || productPack.mode === "match") {
      const nextMeta: Record<string, unknown> = { ...prevMeta };
      if (productPack.mode === "clarify") {
        nextMeta.pending_product_options = productPack.products.map((p) => ({
          id: p.id,
          name: p.name,
        }));
      } else {
        delete nextMeta.pending_product_options;
      }
      await supabase.from("conversations").update({ metadata: nextMeta }).eq("id", data.conversationId);

      const media =
        productPack.mode === "match" ? buildProductPackMedia(productPack.products) : [];
      const images = media
        .filter((m) => m.imageUrl)
        .map((m) => ({
          url: m.imageUrl as string,
          title: "Product photo",
          file_name: `${m.productName}.jpg`,
        }));
      const downloadLinks = media
        .filter((m) => m.catalogueUrl)
        .map((m) => ({
          title: "Catalogue",
          url: m.catalogueUrl as string,
          file_name: m.catalogueFileName || "catalogue.pdf",
        }));

      const inspector = buildAnswerInspector({
        chunks: [],
        replySource: "openai",
        model: "gpt-4o-mini",
        agentName: "EnerBot",
        channel: (convo.channel as string) || "website",
        visitorName: convo.visitor_name || "Website visitor",
        downloadCount: downloadLinks.length,
        memoryEnabled: true,
      });

      const reply = productPack.message;
      const { error: packErr } = await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: data.conversationId,
        sender: "ai",
        body: reply,
        confidence: inspector.confidence,
        sources: inspector.sources,
        metadata: {
          ...inspector.metadata,
          product_pack: true,
          product_pack_mode: productPack.mode,
          product_ids: productPack.products.map((p) => p.id),
          reference_images: images,
          download_links: downloadLinks.map((l) => ({
            title: l.title,
            url: l.url,
            file_name: l.file_name,
          })),
        },
      });
      if (packErr) throw new Error(packErr.message);

      await supabase
        .from("conversations")
        .update({
          preview: reply.slice(0, 160),
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.conversationId);

      return {
        messages: await getConversationMessages(supabase, data.conversationId),
        reply,
        source: "openai",
        aiPaused: false,
        status: convo.status,
      };
    }

    const catalogue = await resolveCatalogueRequest(text, { pendingOptions: pendingCatalogue });

    // Catalogue intent: short reply + at most one PDF (or numbered choices)
    if (catalogue.mode === "clarify" || catalogue.mode === "match") {
      const { shortenDownloadLinks } = await import("@/server/shorten-urls");
      const downloadLinks =
        catalogue.mode === "match" ? await shortenDownloadLinks(catalogue.downloads.slice(0, 1)) : [];
      const reply =
        catalogue.mode === "match"
          ? catalogue.message || "Here is the catalogue."
          : catalogue.message;

      const nextMeta: Record<string, unknown> = { ...prevMeta };
      if (catalogue.mode === "clarify") {
        nextMeta.pending_catalogue_options = catalogue.clarifyOptions.map((o) => ({
          documentId: o.documentId,
          label: o.label,
          title: o.title,
          url: o.url,
          fileName: o.fileName,
        }));
      } else if (catalogue.mode === "match" && catalogue.fromPending) {
        // Keep list for another number pick
      } else if (catalogue.mode === "match") {
        delete nextMeta.pending_catalogue_options;
      }
      await supabase.from("conversations").update({ metadata: nextMeta }).eq("id", data.conversationId);

      const inspector = buildAnswerInspector({
        chunks: [],
        replySource: "openai",
        model: "gpt-4o-mini",
        agentName: "EnerBot",
        channel: (convo.channel as string) || "website",
        visitorName: convo.visitor_name || "Website visitor",
        downloadCount: downloadLinks.length,
        memoryEnabled: true,
      });

      const { error: aiErr } = await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: data.conversationId,
        sender: "ai",
        body: reply,
        confidence: inspector.confidence,
        sources: inspector.sources,
        metadata: {
          ...inspector.metadata,
          catalogue_mode: catalogue.mode,
          download_links: downloadLinks.map((l) => ({
            title: l.title,
            url: l.url,
            file_name: l.fileName || l.title,
          })),
        },
      });
      if (aiErr) throw new Error(aiErr.message);

      await supabase
        .from("conversations")
        .update({
          preview: reply.slice(0, 160),
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.conversationId);

      return {
        messages: await getConversationMessages(supabase, data.conversationId),
        reply,
        source: "openai",
        aiPaused: false,
        status: convo.status,
      };
    }

    // Service ticket intake (structured after-sales)
    const existingTicket = (prevMeta.service_ticket as ServiceTicket | undefined) || null;
    if (isServiceIntent(text) || (existingTicket && existingTicket.status === "collecting")) {
      const base = existingTicket || emptyServiceTicket();
      const ticket = mergeServiceTicketFromText(base, text);
      const tags = Array.isArray(convo.tags) ? [...convo.tags] : [];
      if (!tags.includes("Service")) tags.push("Service");
      const nextMeta: Record<string, unknown> = { ...prevMeta, service_ticket: ticket };
      delete nextMeta.pending_catalogue_options;
      const reply = nextServiceTicketPrompt(ticket, sessionLang);
      const patch: Record<string, unknown> = {
        metadata: nextMeta,
        tags,
        preview: reply.slice(0, 160),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (ticket.status === "ready") {
        nextMeta.service_ticket = { ...ticket, status: "handed_off" };
        patch.metadata = nextMeta;
        patch.status = "escalated";
        patch.assignee_label = "Human queue";
      }
      await supabase.from("conversations").update(patch).eq("id", data.conversationId);
      await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: data.conversationId,
        sender: "ai",
        body: reply,
        metadata: { service_ticket: ticket },
      });
      if (ticket.status === "ready") {
        try {
          const { fireAutomations } = await import("@/server/automation-engine");
          fireAutomations("conversation_escalated", { conversationId: data.conversationId });
        } catch (err) {
          console.error("service escalate automation", err);
        }
      }
      return {
        messages: await getConversationMessages(supabase, data.conversationId),
        reply,
        source: "openai",
        aiPaused: ticket.status === "ready",
        status: ticket.status === "ready" ? "escalated" : convo.status,
      };
    }

    const sentPhotoIds = Array.isArray(prevMeta.sent_reference_ids)
      ? (prevMeta.sent_reference_ids as string[])
      : [];
    const lastCollection =
      typeof prevMeta.last_reference_collection === "string"
        ? prevMeta.last_reference_collection
        : null;
    const askingMore = customerAskedForMorePhotos(text);

    const [chunks, referenceImages] = await Promise.all([
      retrieveKnowledgeContext(text, 6),
      findReferenceImages(text, 3, {
        excludeDocumentIds: sentPhotoIds,
        preferCollection: askingMore ? lastCollection : null,
      }),
    ]);

    if (
      referenceImages.length > 0 &&
      (wantsReferenceImages(text) || (askingMore && lastCollection))
    ) {
      const photos = referenceImages.slice(0, 3);
      const reply = askingMore
        ? referencePhotosReplyForLang(sessionLang, true)
        : referencePhotosReplyForLang(sessionLang, false);
      const newIds = [...sentPhotoIds, ...photos.map((p) => p.documentId)];
      const collection = photos[0]?.collection || lastCollection;
      const inspector = buildAnswerInspector({
        chunks: [],
        replySource: "openai",
        model: "gpt-4o-mini",
        agentName: "EnerBot",
        channel: (convo.channel as string) || "website",
        visitorName: convo.visitor_name || "Website visitor",
        downloadCount: 0,
        memoryEnabled: true,
      });
      await supabase
        .from("conversations")
        .update({
          metadata: {
            ...prevMeta,
            sent_reference_ids: newIds.slice(-30),
            last_reference_collection: collection,
          },
        })
        .eq("id", data.conversationId);
      const { error: photoErr } = await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: data.conversationId,
        sender: "ai",
        body: reply,
        confidence: inspector.confidence,
        sources: inspector.sources,
        metadata: {
          ...inspector.metadata,
          reference_images: photos.map((r) => ({
            url: r.imageUrl,
            title: r.title,
            collection: r.collection,
            file_name: r.fileName,
            mime_type: r.mimeType,
            document_id: r.documentId,
          })),
        },
      });
      if (photoErr) throw new Error(photoErr.message);
      await supabase
        .from("conversations")
        .update({
          preview: reply.slice(0, 160),
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.conversationId);
      return {
        messages: await getConversationMessages(supabase, data.conversationId),
        reply,
        source: "openai",
        aiPaused: false,
        status: convo.status,
      };
    }

    // Photos/assets asked but not in Knowledge Base yet — soft wait, flag for team
    if (wantsReferenceImages(text) && referenceImages.length === 0) {
      const reply = kbPendingSendReplyForLang(sessionLang);
      const tags = Array.isArray(convo.tags) ? [...convo.tags] : [];
      if (!tags.includes("Needs asset")) tags.push("Needs asset");
      await supabase
        .from("conversations")
        .update({
          metadata: {
            ...prevMeta,
            preferred_lang: sessionLang,
            pending_kb_request: {
              type: "reference_photos",
              query: text.slice(0, 240),
              at: new Date().toISOString(),
            },
          },
          tags,
          preview: reply.slice(0, 160),
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.conversationId);
      await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: data.conversationId,
        sender: "ai",
        body: reply,
        metadata: { pending_kb: true, human_like_wait: true },
      });
      try {
        await supabase.from("notifications").insert({
          org_id: ORG_ID,
          title: "Customer asked for photos / assets",
          body: text.slice(0, 160),
          href: `/inbox?c=${data.conversationId}`,
          conversation_id: data.conversationId,
          metadata: { pending_kb: true },
        });
      } catch (err) {
        console.error("pending KB notify failed", err);
      }
      return {
        messages: await getConversationMessages(supabase, data.conversationId),
        reply,
        source: "fallback",
        aiPaused: false,
        status: convo.status,
      };
    }

    if (askingMore && lastCollection && referenceImages.length === 0) {
      const reply =
        sessionLang === "hi" || sessionLang === "mixed"
          ? "Sir, abhi ke liye saari available reference photos share kar di. Catalogue ya service chahiye to bataiye."
          : sessionLang === "mr"
            ? "Sir, atapare available reference photos share kele. Catalogue kinva service pahije asel tar sanga."
            : "Sir, I have shared all available reference photos for now. Please tell me if you need a catalogue or service help.";
      await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: data.conversationId,
        sender: "ai",
        body: reply,
      });
      await supabase
        .from("conversations")
        .update({
          preview: reply.slice(0, 160),
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.conversationId);
      return {
        messages: await getConversationMessages(supabase, data.conversationId),
        reply,
        source: "openai",
        aiPaused: false,
        status: convo.status,
      };
    }

    if (isOffTopicMessage(text, { conversationActive: priorHistory.length > 0 })) {
      const reply = offTopicReplyForLang(sessionLang);
      const inspector = buildAnswerInspector({
        chunks: [],
        replySource: "fallback",
        model: "gpt-4o-mini",
        agentName: "EnerBot",
        channel: (convo.channel as string) || "website",
        visitorName: convo.visitor_name || "Website visitor",
        downloadCount: 0,
        memoryEnabled: true,
      });
      const { error: offErr } = await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: data.conversationId,
        sender: "ai",
        body: reply,
        confidence: inspector.confidence,
        sources: inspector.sources,
        metadata: { ...inspector.metadata, off_topic: true },
      });
      if (offErr) throw new Error(offErr.message);
      await supabase
        .from("conversations")
        .update({
          preview: reply.slice(0, 160),
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.conversationId);
      return {
        messages: await getConversationMessages(supabase, data.conversationId),
        reply,
        source: "fallback",
        aiPaused: false,
        status: convo.status,
      };
    }

    const knowledgeContext = chunks
      .map((c, i) => `[${i + 1}] (${c.document_title}, relevance ${c.similarity.toFixed(2)})\n${c.content}`)
      .join("\n\n")
      .replace(/https?:\/\/[^\s)\]>"']+\/storage\/v1\/object\/public\/knowledge\/[^\s)\]>"']+/gi, "[file]");

    const productsContext = await buildProductsContextForAi(text);

    const { sanitizeAssistantFileLinks } = await import("@/server/shorten-urls");
    const downloadLinks: Array<{ title: string; url: string; fileName?: string }> = [];

    const stack = await resolveAgentStack({
      channel: (convo.channel as string) || "website",
      message: text,
    });
    const agentCfg = agentReplyConfig(stack);

    const ai = await generateOpenAiReply({
      visitorName: convo.visitor_name || "Website visitor",
      latestUserMessage: text,
      history: priorHistory,
      knowledgeContext,
      productsContext,
      downloadLinks,
      referenceImages: [],
      systemPrompt: agentCfg.systemPrompt,
      model: agentCfg.model,
      agentName: agentCfg.agentName,
      memoryEnabled: agentCfg.memoryEnabled,
      toolKeys: await resolveAgentToolKeys({ allowedOnAgent: agentCfg.allowedTools }),
      replyLanguage: sessionLang,
    });
    const reply = await sanitizeAssistantFileLinks(
      ai.reply || buildPlaceholderAiReply(text),
      downloadLinks,
      { channel: "website" },
    );
    const source = ai.source;
    const inspector = buildAnswerInspector({
      chunks,
      replySource: source,
      model: ai.model,
      agentName: agentCfg.agentName,
      specialistKey: agentCfg.specialistKey,
      channel: (convo.channel as string) || "website",
      visitorName: convo.visitor_name || "Website visitor",
      downloadCount: downloadLinks.length,
      memoryEnabled: agentCfg.memoryEnabled,
    });

    const { error: aiErr } = await supabase.from("messages").insert({
      org_id: ORG_ID,
      conversation_id: data.conversationId,
      sender: "ai",
      body: reply,
      confidence: inspector.confidence,
      sources: inspector.sources,
      metadata: {
        ...inspector.metadata,
        download_links: downloadLinks.map((l) => ({
          title: l.title,
          url: l.url,
          file_name: l.fileName || l.title,
        })),
        reference_images: [],
      },
    });
    if (aiErr) throw new Error(aiErr.message);
    const convoPatch: Record<string, unknown> = {};
    if (agentCfg.agentId) {
      const prevMeta =
        convo.metadata && typeof convo.metadata === "object"
          ? (convo.metadata as Record<string, unknown>)
          : {};
      convoPatch.agent_id = agentCfg.agentId;
      convoPatch.assignee_label = agentCfg.assigneeLabel;
      convoPatch.metadata = {
        ...prevMeta,
        preferred_lang: sessionLang,
        specialist_key: agentCfg.specialistKey,
        specialist_id: agentCfg.specialistId,
      };
    }
    if (Object.keys(convoPatch).length > 0) {
      await supabase.from("conversations").update(convoPatch).eq("id", data.conversationId);
    }

    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return {
      messages: messages ?? [],
      reply,
      source,
      aiPaused: false,
      status: convo.status,
    };
  });

/** Website carousel: customer tapped “I need this” → Name, Photo, Price, Features, Catalogue. */
export const widgetSelectProduct = createServerFn({ method: "POST" })
  .validator(
    z.object({
      key: z.string().min(1),
      pageOrigin: z.string().max(500).optional(),
      conversationId: z.string().uuid(),
      productId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    await assertWidgetAccess(data.key, data.pageOrigin);
    const supabase = createServiceSupabase();

    const { data: convo, error: convoError } = await supabase
      .from("conversations")
      .select("id, status, visitor_name, metadata, unread_count, channel")
      .eq("id", data.conversationId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (convoError) throw new Error(convoError.message);
    if (!convo) throw new Error("Conversation not found");

    const aiPaused =
      convo.status === "human" ||
      convo.status === "escalated" ||
      convo.status === "resolved" ||
      convo.status === "closed";

    const product = await loadActiveProductById(data.productId);
    if (!product) throw new Error("Product not found");

    const displayName = cleanProductDisplayName(product.name);
    const customerBody = `I need this — ${displayName}`;

    const { error: customerErr } = await supabase.from("messages").insert({
      org_id: ORG_ID,
      conversation_id: data.conversationId,
      sender: "customer",
      body: customerBody,
      metadata: { product_select: true, product_id: product.id },
    });
    if (customerErr) throw new Error(customerErr.message);

    const unread = Number(convo.unread_count || 0) + 1;
    await supabase
      .from("conversations")
      .update({
        unread_count: unread,
        preview: customerBody.slice(0, 160),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.conversationId);

    if (aiPaused) {
      return {
        messages: await getConversationMessages(supabase, data.conversationId),
        reply: null as string | null,
        source: "fallback" as const,
        aiPaused: true,
        status: convo.status as string,
      };
    }

    const media = buildProductPackMedia([product])[0]!;
    const reply = formatProductPackBody(product);
    const images = media.imageUrl
      ? [{ url: media.imageUrl, title: "Product photo", file_name: `${media.productName}.jpg` }]
      : [];
    const downloadLinks = media.catalogueUrl
      ? [
          {
            title: "Catalogue",
            url: media.catalogueUrl,
            file_name: media.catalogueFileName || "catalogue.pdf",
          },
        ]
      : [];

    const inspector = buildAnswerInspector({
      chunks: [],
      replySource: "openai",
      model: "gpt-4o-mini",
      agentName: "EnerBot",
      channel: (convo.channel as string) || "website",
      visitorName: (convo.visitor_name as string) || "Website visitor",
      downloadCount: downloadLinks.length,
      memoryEnabled: true,
    });

    const prevMeta =
      convo.metadata && typeof convo.metadata === "object"
        ? { ...(convo.metadata as Record<string, unknown>) }
        : {};
    delete prevMeta.pending_product_options;

    const { error: aiErr } = await supabase.from("messages").insert({
      org_id: ORG_ID,
      conversation_id: data.conversationId,
      sender: "ai",
      body: reply,
      confidence: inspector.confidence,
      sources: inspector.sources,
      metadata: {
        ...inspector.metadata,
        product_pack: true,
        product_pack_mode: "match",
        product_ids: [product.id],
        reference_images: images,
        download_links: downloadLinks,
      },
    });
    if (aiErr) throw new Error(aiErr.message);

    await supabase
      .from("conversations")
      .update({
        metadata: prevMeta,
        preview: reply.slice(0, 160),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.conversationId);

    return {
      messages: await getConversationMessages(supabase, data.conversationId),
      reply,
      source: "openai" as const,
      aiPaused: false,
      status: convo.status as string,
    };
  });

const CHAT_BUCKET = "knowledge";

function chatPublicUrl(path: string): string {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${CHAT_BUCKET}/${path}`;
}

/** Upload a visitor attachment (image/PDF) into the conversation. */
export const widgetUploadAttachment = createServerFn({ method: "POST" })
  .validator(
    z.object({
      key: z.string().min(1),
      pageOrigin: z.string().max(500).optional(),
      conversationId: z.string().uuid(),
      fileName: z.string().min(1).max(180),
      mimeType: z.string().max(120).optional(),
      base64: z.string().min(1).max(12_000_000),
    }),
  )
  .handler(async ({ data }) => {
    await assertWidgetAccess(data.key, data.pageOrigin);
    const supabase = createServiceSupabase();

    const { data: convo, error: convoError } = await supabase
      .from("conversations")
      .select("id, status")
      .eq("id", data.conversationId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (convoError) throw new Error(convoError.message);
    if (!convo) throw new Error("Conversation not found");

    const lower = data.fileName.toLowerCase();
    const mime = (data.mimeType || "").toLowerCase();
    const allowed =
      mime.startsWith("image/") ||
      mime === "application/pdf" ||
      lower.endsWith(".png") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".webp") ||
      lower.endsWith(".gif") ||
      lower.endsWith(".pdf");
    if (!allowed) {
      throw new Error("Only images (PNG/JPG/WEBP/GIF) or PDF files are supported.");
    }

    const safeName = data.fileName.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 120);
    const storagePath = `chat/${ORG_ID}/${data.conversationId}/${Date.now()}-${safeName}`;
    const buffer = Buffer.from(data.base64, "base64");
    if (buffer.byteLength > 8 * 1024 * 1024) {
      throw new Error("File too large (max 8 MB).");
    }

    const { error: uploadError } = await supabase.storage.from(CHAT_BUCKET).upload(storagePath, buffer, {
      contentType: data.mimeType || "application/octet-stream",
      upsert: false,
    });
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const url = chatPublicUrl(storagePath);
    const isImage =
      mime.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif)$/i.test(lower);
    const body = isImage
      ? `Shared an image: ${safeName}\n${url}`
      : `Shared a file: ${safeName}\n${url}`;

    const { error: msgErr } = await supabase.from("messages").insert({
      org_id: ORG_ID,
      conversation_id: data.conversationId,
      sender: "customer",
      body,
      metadata: {
        attachment: true,
        file_name: safeName,
        mime_type: data.mimeType || null,
        storage_path: storagePath,
        url,
      },
    });
    if (msgErr) throw new Error(msgErr.message);

    const aiPaused =
      convo.status === "human" ||
      convo.status === "escalated" ||
      convo.status === "resolved" ||
      convo.status === "closed";

    let reply: string | null = null;
    if (!aiPaused) {
      reply =
        "Thanks ? I received your file. Our team can review it in the inbox. Tell me what you need help with, or ask to talk to a human.";
      await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: data.conversationId,
        sender: "ai",
        body: reply,
        confidence: 0.9,
        sources: [],
        metadata: {
          inspector: true,
          hallucination_risk: "Low",
          reasoning: ["Customer uploaded an attachment.", "Acknowledged receipt without inventing file contents."],
          memory: "Attachment saved on the conversation for human review.",
          agent_name: "EnerBot",
          specialist_key: null,
          model: "rules",
          reply_source: "fallback",
          grounded: false,
          download_count: 0,
        },
      });
    }

    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    return {
      messages: messages ?? [],
      reply,
      url,
      status: convo.status,
      aiPaused,
    };
  });
