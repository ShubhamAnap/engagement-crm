import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { buildPlaceholderAiReply } from "@/lib/chat-replies";
import { isWidgetOriginAllowed, normalizeWidgetHost } from "@/lib/widget-origins";
import { generateOpenAiReply } from "@/server/openai";
import { agentReplyConfig, resolveAgentStack } from "@/server/agents";
import { resolveAgentToolKeys } from "@/server/ai-tools";
import { buildAnswerInspector } from "@/server/answer-inspector";
import { findCatalogueDownloads, findReferenceImages, retrieveKnowledgeContext } from "@/server/knowledge";

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
      "This website is not allowed to use the EnerTech chat widget. Ask EnerTech to add your domain under Channels → Website.",
    );
  }
}

async function assertWidgetAccess(key: string, pageOrigin?: string | null) {
  assertWidgetKey(key);
  await assertWidgetPageOrigin(pageOrigin);
}

function normalizeVisitor(fields: VisitorFields) {
  return {
    visitor_name: fields.visitorName?.trim() || null,
    visitor_email: fields.visitorEmail?.trim() || null,
    visitor_phone: fields.visitorPhone?.trim() || null,
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
  if (current) return current;
  const next = incoming?.trim();
  return next || null;
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
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, email, phone, company, metadata")
      .eq("org_id", ORG_ID)
      .eq("phone", normalizedPhone)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;
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
    .select("sender, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(20);

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
  fields: VisitorFields,
) {
  const normalized = normalizeVisitor(fields);
  const updates = {
    visitor_name: normalized.visitor_name || convo.visitor_name || "Website visitor",
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
        name: preferExisting(customer?.name, updates.visitor_name) || "Website visitor",
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

  if (convo.lead_id) {
    const { data: lead } = await supabase
      .from("leads")
      .select("name, email, phone, company, metadata")
      .eq("id", convo.lead_id)
      .maybeSingle();

    await supabase
      .from("leads")
      .update({
        name: preferExisting(lead?.name, updates.visitor_name) || "Website visitor",
        email: preferExisting(lead?.email, updates.visitor_email),
        phone: preferExisting(lead?.phone, updates.visitor_phone),
        company: preferExisting(lead?.company, updates.visitor_company),
        customer_id: customerId || convo.customer_id,
        metadata: withLocationMetadata(
          (lead?.metadata as Record<string, unknown> | null) ?? {},
          normalized.visitor_location,
        ),
      })
      .eq("id", convo.lead_id);
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
          name: preferExisting(existing.name, convo.visitor_name) || "Website visitor",
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

    // Prefer the contact's latest open website conversation when identity is known.
    if (visitor.visitor_email || visitor.visitor_phone || matched?.id) {
      const contactConvo = await findLatestOpenWebsiteConversation(supabase, {
        customerId: matched?.id ?? null,
        email: visitor.visitor_email || matched?.email,
        phone: visitor.visitor_phone || matched?.phone,
        excludeId: null,
      });

      if (contactConvo) {
        // If this browser session already has an empty placeholder thread, drop it.
        if (bySession && bySession.id !== contactConvo.id) {
          const msgCount = await countConversationMessages(supabase, bySession.id);
          if (msgCount === 0) {
            await supabase.from("conversations").delete().eq("id", bySession.id);
          }
        }
        return attachSessionAndSync(supabase, contactConvo, data);
      }
    }

    if (bySession) {
      return attachSessionAndSync(supabase, bySession, data);
    }

    const channelId = await getWebsiteChannelId(supabase);
    const { data: created, error: createError } = await supabase
      .from("conversations")
      .insert({
        org_id: ORG_ID,
        channel_id: channelId,
        channel: "website",
        external_ref: `CV-${Date.now().toString().slice(-6)}`,
        status: "ai",
        assignee_label: "AI · GPT-4o-mini",
        visitor_name: visitor.visitor_name || matched?.name || "Website visitor",
        visitor_email: visitor.visitor_email || matched?.email,
        visitor_phone: visitor.visitor_phone || matched?.phone,
        visitor_company: visitor.visitor_company || matched?.company,
        metadata: withLocationMetadata(
          {},
          visitor.visitor_location ||
            (typeof matched?.metadata?.location === "string" ? matched.metadata.location : null),
        ),
        customer_id: matched?.id ?? null,
        widget_session_id: data.sessionId,
        tags: ["Website", "Embed"],
        unread_count: 0,
      })
      .select("*")
      .single();

    if (createError) throw new Error(createError.message);
    if (matched || visitor.visitor_email || visitor.visitor_phone || visitor.visitor_name) {
      await syncConversationIdentity(supabase, created, data);
      const { data: refreshed, error: refreshError } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", created.id)
        .single();
      if (refreshError) throw new Error(refreshError.message);
      return refreshed;
    }
    return created;
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
      .select("id, status, visitor_name, visitor_email, visitor_phone, visitor_company, customer_id, lead_id, tags, metadata, agent_id, channel")
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

    await ensureConversationLinks(supabase, convo, text);

    const escalate = /human|agent|support executive/i.test(text);
    const aiPaused = convo.status === "human" || convo.status === "escalated" || convo.status === "resolved" || convo.status === "closed";

    // Human takeover / escalated: save customer message only — do not call OpenAI.
    if (aiPaused) {
      const { data: messages, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", data.conversationId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return { messages: messages ?? [], reply: null, source: "paused", aiPaused: true, status: convo.status };
    }

    const history = await getConversationMessages(supabase, data.conversationId);
    const priorHistory =
      history[history.length - 1]?.sender === "customer" && history[history.length - 1]?.body === text
        ? history.slice(0, -1)
        : history;

    const [chunks, downloads, referenceImages] = await Promise.all([
      retrieveKnowledgeContext(text, 6),
      findCatalogueDownloads(text),
      findReferenceImages(text, 3),
    ]);

    const knowledgeContext = chunks
      .map((c, i) => `[${i + 1}] (${c.document_title}, relevance ${c.similarity.toFixed(2)})\n${c.content}`)
      .join("\n\n")
      .replace(/https?:\/\/[^\s)\]>"']+\/storage\/v1\/object\/public\/knowledge\/[^\s)\]>"']+/gi, "[file]");

    const { sanitizeAssistantFileLinks, shortenDownloadLinks } = await import("@/server/shorten-urls");
    // Prefer Datasheets catalogue matches; don't mix random chunk URLs that can be long/broken.
    let downloadLinks = await shortenDownloadLinks(
      (downloads.length > 0
        ? downloads
        : chunks
            .filter((c) => c.download_url)
            .map((c) => ({
              title: /\.pdf$/i.test(c.document_title) ? c.document_title : `${c.document_title}.pdf`,
              url: c.download_url as string,
              fileName: /\.pdf$/i.test(c.document_title) ? c.document_title : `${c.document_title}.pdf`,
            }))
      )
        .filter((link, index, arr) => arr.findIndex((x) => x.url === link.url) === index)
        .filter((link) => !referenceImages.some((img) => link.url.includes(img.documentId)))
        .slice(0, 5),
    );

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
      downloadLinks,
      referenceImages: referenceImages.map((r) => ({ title: r.title, collection: r.collection })),
      systemPrompt: agentCfg.systemPrompt,
      model: agentCfg.model,
      agentName: agentCfg.agentName,
      memoryEnabled: agentCfg.memoryEnabled,
      toolKeys: await resolveAgentToolKeys({ allowedOnAgent: agentCfg.allowedTools }),
    });
    let reply = await sanitizeAssistantFileLinks(
      ai.reply || buildPlaceholderAiReply(text),
      downloadLinks,
      { channel: "website" },
    );
    if (referenceImages.length > 0 && !/reference|photo|image|install/i.test(reply)) {
      const collections = [...new Set(referenceImages.map((r) => r.collection))];
      reply += `\n\nSharing ${referenceImages.length} reference photo(s) from ${collections.join(", ")}. Tap a photo to open or download.`;
    }
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
        reference_images: referenceImages.map((r) => ({
          url: r.imageUrl,
          title: r.title,
          collection: r.collection,
          file_name: r.fileName,
          mime_type: r.mimeType,
          document_id: r.documentId,
        })),
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
        specialist_key: agentCfg.specialistKey,
        specialist_id: agentCfg.specialistId,
      };
    }
    if (escalate) {
      convoPatch.status = "escalated";
      convoPatch.assignee_label = "Human queue";
      await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: data.conversationId,
        sender: "system",
        body: "Connecting you to a human support executive. An agent will reply here shortly — you can keep typing while you wait.",
        metadata: { handoff: true },
      });
    }
    if (Object.keys(convoPatch).length > 0) {
      await supabase.from("conversations").update(convoPatch).eq("id", data.conversationId);
    }
    if (escalate) {
      try {
        const { fireAutomations } = await import("@/server/automation-engine");
        fireAutomations("conversation_escalated", {
          conversationId: data.conversationId,
        });
      } catch (err) {
        console.error("escalation automation", err);
      }
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
      status: escalate ? "escalated" : convo.status,
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
        "Thanks — I received your file. Our team can review it in the inbox. Tell me what you need help with, or ask to talk to a human.";
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
