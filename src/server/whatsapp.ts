import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { generateOpenAiReply } from "@/server/openai";
import { agentReplyConfig, resolveAgentStack } from "@/server/agents";
import { resolveAgentToolKeys } from "@/server/ai-tools";
import { buildAnswerInspector } from "@/server/answer-inspector";
import { findCatalogueDownloads, findReferenceImages, retrieveKnowledgeContext } from "@/server/knowledge";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export type WhatsAppChannelConfig = {
  phone_number_id?: string;
  access_token?: string;
  verify_token?: string;
  business_account_id?: string;
  display_phone?: string;
};

function envConfig(): WhatsAppChannelConfig {
  return {
    phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || undefined,
    access_token: process.env.WHATSAPP_ACCESS_TOKEN || undefined,
    verify_token: process.env.WHATSAPP_VERIFY_TOKEN || undefined,
    business_account_id: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || undefined,
    display_phone: process.env.WHATSAPP_DISPLAY_PHONE || undefined,
  };
}

export async function loadWhatsAppConfig(): Promise<WhatsAppChannelConfig> {
  const fromEnv = envConfig();
  try {
    const supabase = createServiceSupabase();
    const { data } = await supabase
      .from("channels")
      .select("config, detail, is_enabled, status")
      .eq("org_id", ORG_ID)
      .eq("type", "whatsapp")
      .maybeSingle();
    const cfg = ((data?.config as WhatsAppChannelConfig) || {}) as WhatsAppChannelConfig;
    return {
      phone_number_id: cfg.phone_number_id || fromEnv.phone_number_id,
      access_token: cfg.access_token || fromEnv.access_token,
      verify_token: cfg.verify_token || fromEnv.verify_token,
      business_account_id: cfg.business_account_id || fromEnv.business_account_id,
      display_phone: cfg.display_phone || fromEnv.display_phone || (data?.detail as string) || undefined,
    };
  } catch {
    return fromEnv;
  }
}

export function whatsappConfigReady(cfg: WhatsAppChannelConfig): boolean {
  return Boolean(cfg.phone_number_id && cfg.access_token && cfg.verify_token);
}

export async function sendWhatsAppText(toPhone: string, body: string, cfg?: WhatsAppChannelConfig) {
  const config = cfg || (await loadWhatsAppConfig());
  if (!config.phone_number_id || !config.access_token) {
    throw new Error("WhatsApp is not configured (missing phone_number_id or access_token)");
  }
  const { normalizeWhatsAppDigits } = await import("@/lib/whatsapp-window");
  const to = normalizeWhatsAppDigits(toPhone) || toPhone.replace(/\D/g, "");
  if (!to) throw new Error("Invalid WhatsApp recipient phone");

  const res = await fetch(`${GRAPH_BASE}/${config.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body },
    }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err =
      (json.error as { message?: string } | undefined)?.message ||
      `WhatsApp API error (${res.status})`;
    throw new Error(err);
  }
  return json;
}

export async function sendWhatsAppImage(options: {
  toPhone: string;
  imageUrl: string;
  caption?: string;
  cfg?: WhatsAppChannelConfig;
}) {
  const config = options.cfg || (await loadWhatsAppConfig());
  if (!config.phone_number_id || !config.access_token) {
    throw new Error("WhatsApp is not configured (missing phone_number_id or access_token)");
  }
  const { normalizeWhatsAppDigits } = await import("@/lib/whatsapp-window");
  const to = normalizeWhatsAppDigits(options.toPhone) || options.toPhone.replace(/\D/g, "");
  if (!to) throw new Error("Invalid WhatsApp recipient phone");
  if (!/^https:\/\//i.test(options.imageUrl)) {
    throw new Error("Product image must be a public HTTPS URL for WhatsApp");
  }

  const res = await fetch(`${GRAPH_BASE}/${config.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: {
        link: options.imageUrl,
        ...(options.caption ? { caption: options.caption.slice(0, 1024) } : {}),
      },
    }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err =
      (json.error as { message?: string } | undefined)?.message ||
      `WhatsApp image API error (${res.status})`;
    throw new Error(err);
  }
  return json;
}

async function getWhatsAppChannelId(supabase: ReturnType<typeof createServiceSupabase>) {
  const { data } = await supabase
    .from("channels")
    .select("id")
    .eq("org_id", ORG_ID)
    .eq("type", "whatsapp")
    .maybeSingle();
  return data?.id as string | undefined;
}

async function findOrCreateWhatsAppConversation(
  supabase: ReturnType<typeof createServiceSupabase>,
  phone: string,
  profileName?: string,
) {
  const normalized = phone.replace(/\D/g, "");
  const sessionKey = `wa:${normalized}`;

  const { data: existing } = await supabase
    .from("conversations")
    .select("*")
    .eq("org_id", ORG_ID)
    .eq("channel", "whatsapp")
    .eq("widget_session_id", sessionKey)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (profileName && !existing.visitor_name) patch.visitor_name = profileName;
    if (!existing.visitor_phone) patch.visitor_phone = normalized;
    if (Object.keys(patch).length > 0) {
      await supabase.from("conversations").update(patch).eq("id", existing.id);
    }
    return existing;
  }

  const channelId = await getWhatsAppChannelId(supabase);
  const externalRef = `WA-${normalized.slice(-6) || Date.now().toString().slice(-6)}`;

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      org_id: ORG_ID,
      channel_id: channelId || null,
      channel: "whatsapp",
      external_ref: externalRef,
      status: "ai",
      assignee_label: "AI · Support Agent",
      visitor_name: profileName || `WhatsApp ${normalized.slice(-4)}`,
      visitor_phone: normalized,
      widget_session_id: sessionKey,
      tags: ["WhatsApp"],
      unread_count: 0,
      metadata: { wa_id: normalized },
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return created;
}

export async function handleWhatsAppInboundPayload(payload: unknown) {
  const supabase = createServiceSupabase();
  const cfg = await loadWhatsAppConfig();
  const root = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
          messages?: Array<{
            from?: string;
            id?: string;
            timestamp?: string;
            type?: string;
            text?: { body?: string };
          }>;
        };
      }>;
    }>;
  };

  const results: Array<{ conversationId: string; messageId: string }> = [];

  for (const entry of root.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value?.messages?.length) continue;
      const contactName = value.contacts?.[0]?.profile?.name;

      for (const msg of value.messages) {
        if (msg.type && msg.type !== "text") continue;
        const from = msg.from;
        const text = msg.text?.body?.trim();
        if (!from || !text) continue;

        // Dedupe by Meta message id in metadata
        if (msg.id) {
          const { data: dup } = await supabase
            .from("messages")
            .select("id")
            .eq("org_id", ORG_ID)
            .filter("metadata->>wa_message_id", "eq", msg.id)
            .limit(1)
            .maybeSingle();
          if (dup) continue;
        }

        const convo = await findOrCreateWhatsAppConversation(supabase, from, contactName);

        const { data: customerMsg, error: msgError } = await supabase
          .from("messages")
          .insert({
            org_id: ORG_ID,
            conversation_id: convo.id,
            sender: "customer",
            body: text,
            metadata: { wa_message_id: msg.id || null, wa_from: from },
          })
          .select("*")
          .single();
        if (msgError) throw new Error(msgError.message);

        const nowIso = new Date().toISOString();
        const unread = Number(convo.unread_count || 0) + 1;
        const { error: winErr } = await supabase
          .from("conversations")
          .update({
            wa_last_customer_at: nowIso,
            last_message_at: nowIso,
            preview: text.slice(0, 160),
            unread_count: unread,
            updated_at: nowIso,
          })
          .eq("id", convo.id);
        if (winErr) {
          // Migration 017 not applied yet — still refresh preview/unread
          await supabase
            .from("conversations")
            .update({
              last_message_at: nowIso,
              preview: text.slice(0, 160),
              unread_count: unread,
              updated_at: nowIso,
            })
            .eq("id", convo.id);
        }

        results.push({ conversationId: convo.id as string, messageId: customerMsg.id as string });

        // Open Meta window on matching IndiaMART/TradeIndia threads (same phone)
        try {
          const { normalizeWhatsAppDigits } = await import("@/lib/whatsapp-window");
          const digits = normalizeWhatsAppDigits(from);
          if (digits) {
            const last10 = digits.slice(-10);
            const { data: marketRows } = await supabase
              .from("conversations")
              .select("id, visitor_phone")
              .eq("org_id", ORG_ID)
              .in("channel", ["indiamart", "tradeindia"])
              .not("visitor_phone", "is", null)
              .order("updated_at", { ascending: false })
              .limit(150);
            const matchIds = (marketRows || [])
              .filter((row) => {
                const p = normalizeWhatsAppDigits(row.visitor_phone as string);
                return Boolean(p && (p === digits || p.endsWith(last10) || digits.endsWith(p.slice(-10))));
              })
              .map((row) => row.id as string);
            if (matchIds.length > 0) {
              await supabase
                .from("conversations")
                .update({ wa_last_customer_at: nowIso, updated_at: nowIso })
                .in("id", matchIds);
            }
          }
        } catch (err) {
          console.error("marketplace WA window stamp failed", err);
        }

        const status = convo.status as string;
        const escalate = /human|agent|support executive/i.test(text);
        if (escalate) {
          await supabase
            .from("conversations")
            .update({ status: "escalated", assignee_label: "Human queue" })
            .eq("id", convo.id);
          try {
            const { fireAutomations } = await import("@/server/automation-engine");
            fireAutomations("conversation_escalated", { conversationId: convo.id as string });
          } catch (err) {
            console.error("escalation automation", err);
          }
          continue;
        }

        if (status === "human" || status === "escalated" || status === "resolved" || status === "closed") {
          continue;
        }

        // AI reply (same stack as website chat)
        let reply = "Thanks for messaging EnerTech. How can we help with your UPS needs?";
        let inspector = buildAnswerInspector({
          chunks: [],
          replySource: "fallback",
          model: "gpt-4o-mini",
          agentName: "EnerBot",
          channel: "whatsapp",
        });
        try {
          const { data: history } = await supabase
            .from("messages")
            .select("sender, body, created_at")
            .eq("conversation_id", convo.id)
            .order("created_at", { ascending: true })
            .limit(20);
          const [chunks, downloads, referenceImages] = await Promise.all([
            retrieveKnowledgeContext(text, 6),
            findCatalogueDownloads(text),
            findReferenceImages(text, 3),
          ]);
          const knowledgeContext = chunks.map((c) => c.content).join("\n\n");
          const stack = await resolveAgentStack({
            channel: "whatsapp",
            message: text,
          });
          const agentCfg = agentReplyConfig(stack);
          const { rewriteStorageUrlsInText, shortenDownloadLinks } = await import("@/server/shorten-urls");
          const downloadLinks = await shortenDownloadLinks(
            downloads.filter((d) => !referenceImages.some((img) => d.url.includes(img.documentId))),
          );
          const generated = await generateOpenAiReply({
            visitorName: (convo.visitor_name as string) || contactName || "WhatsApp customer",
            latestUserMessage: text,
            history: (history || []).map((m) => ({
              sender: m.sender as string,
              body: m.body as string,
              created_at: m.created_at as string,
            })),
            knowledgeContext,
            downloadLinks,
            referenceImages: referenceImages.map((r) => ({ title: r.title, collection: r.collection })),
            systemPrompt: agentCfg.systemPrompt,
            model: agentCfg.model,
            agentName: agentCfg.agentName,
            memoryEnabled: agentCfg.memoryEnabled,
            toolKeys: await resolveAgentToolKeys({ allowedOnAgent: agentCfg.allowedTools }),
          });
          reply = await rewriteStorageUrlsInText(generated.reply);
          if (downloadLinks.length > 0 && !/https?:\/\//i.test(reply) && !/\.pdf\]\(/i.test(reply)) {
            reply +=
              "\n\n" +
              downloadLinks.map((l) => `📄 ${l.title}\n${l.url}`).join("\n\n");
          }
          if (referenceImages.length > 0 && !/reference|photo|image|install/i.test(reply)) {
            const collections = [...new Set(referenceImages.map((r) => r.collection))];
            reply += `\n\nSending ${referenceImages.length} reference photo(s) from ${collections.join(", ")}.`;
          }
          inspector = buildAnswerInspector({
            chunks,
            replySource: generated.source,
            model: generated.model,
            agentName: agentCfg.agentName,
            specialistKey: agentCfg.specialistKey,
            channel: "whatsapp",
            visitorName: (convo.visitor_name as string) || contactName || "WhatsApp customer",
            downloadCount: downloadLinks.length,
            memoryEnabled: agentCfg.memoryEnabled,
          });
          // Stash on inspector metadata via local var for insert below
          (inspector.metadata as Record<string, unknown>).reference_images = referenceImages.map((r) => ({
            url: r.imageUrl,
            title: r.title,
            collection: r.collection,
            file_name: r.fileName,
            mime_type: r.mimeType,
            document_id: r.documentId,
          }));
          (inspector.metadata as Record<string, unknown>).download_links = downloadLinks.map((l) => ({
            title: l.title,
            url: l.url,
            file_name: l.fileName || l.title,
          }));
          if (agentCfg.agentId) {
            const prevMeta =
              convo.metadata && typeof convo.metadata === "object"
                ? (convo.metadata as Record<string, unknown>)
                : {};
            await supabase
              .from("conversations")
              .update({
                agent_id: agentCfg.agentId,
                assignee_label: agentCfg.assigneeLabel,
                metadata: {
                  ...prevMeta,
                  specialist_key: agentCfg.specialistKey,
                  specialist_id: agentCfg.specialistId,
                },
              })
              .eq("id", convo.id);
          }

          await supabase.from("messages").insert({
            org_id: ORG_ID,
            conversation_id: convo.id,
            sender: "ai",
            body: reply,
            confidence: inspector.confidence,
            sources: inspector.sources,
            metadata: inspector.metadata,
          });

          try {
            await sendWhatsAppText(from, reply, cfg);
          } catch (err) {
            console.error("WhatsApp outbound AI send failed", err);
          }

          for (const img of referenceImages) {
            try {
              await sendWhatsAppImage({
                toPhone: from,
                imageUrl: img.imageUrl,
                caption: `${img.collection}: ${img.title}`.slice(0, 1024),
                cfg,
              });
              await supabase.from("messages").insert({
                org_id: ORG_ID,
                conversation_id: convo.id,
                sender: "ai",
                body: `Reference photo: ${img.title} (${img.collection})\n${img.imageUrl}`,
                metadata: {
                  attachment: true,
                  reference: true,
                  url: img.imageUrl,
                  file_name: img.fileName,
                  mime_type: img.mimeType,
                  collection: img.collection,
                  document_id: img.documentId,
                },
              });
            } catch (err) {
              console.error("WhatsApp reference image send failed", err);
            }
          }
          continue;
        } catch (err) {
          console.error("WhatsApp AI reply failed", err);
        }

        await supabase.from("messages").insert({
          org_id: ORG_ID,
          conversation_id: convo.id,
          sender: "ai",
          body: reply,
          confidence: inspector.confidence,
          sources: inspector.sources,
          metadata: inspector.metadata,
        });

        try {
          await sendWhatsAppText(from, reply, cfg);
        } catch (err) {
          console.error("WhatsApp outbound AI send failed", err);
        }
      }
    }
  }

  return results;
}

/** Save WhatsApp Meta credentials onto the whatsapp channel row. */
export const saveWhatsAppChannelConfig = createServerFn({ method: "POST" })
  .validator(
    z.object({
      phoneNumberId: z.string().min(1).max(80),
      accessToken: z.string().min(10).max(500),
      verifyToken: z.string().min(4).max(200),
      businessAccountId: z.string().max(80).optional(),
      displayPhone: z.string().max(40).optional(),
      enable: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const config: WhatsAppChannelConfig = {
      phone_number_id: data.phoneNumberId.trim(),
      access_token: data.accessToken.trim(),
      verify_token: data.verifyToken.trim(),
      business_account_id: data.businessAccountId?.trim() || undefined,
      display_phone: data.displayPhone?.trim() || undefined,
    };

    const enable = data.enable ?? true;
    const { data: updated, error } = await supabase
      .from("channels")
      .update({
        config,
        detail: config.display_phone || `Phone ID ${config.phone_number_id}`,
        is_enabled: enable,
        status: enable ? "Connected" : "Disconnected",
        health: enable ? 100 : 0,
      })
      .eq("org_id", ORG_ID)
      .eq("type", "whatsapp")
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return {
      ok: true,
      channel: updated,
      webhookPath: "/api/webhooks/whatsapp",
    };
  });

export const getWhatsAppSetupInfo = createServerFn({ method: "GET" }).handler(async () => {
  const cfg = await loadWhatsAppConfig();
  const appUrl = process.env.VITE_APP_URL || process.env.APP_URL || "";
  return {
    configured: whatsappConfigReady(cfg),
    phoneNumberId: cfg.phone_number_id ? `${cfg.phone_number_id.slice(0, 4)}…` : null,
    hasAccessToken: Boolean(cfg.access_token),
    verifyTokenSet: Boolean(cfg.verify_token),
    hasWaba: Boolean(cfg.business_account_id),
    displayPhone: cfg.display_phone || null,
    webhookUrl: appUrl ? `${appUrl.replace(/\/$/, "")}/api/webhooks/whatsapp` : "/api/webhooks/whatsapp",
    needsPublicHttps: !appUrl || /localhost|127\.0\.0\.1/i.test(appUrl),
  };
});

/** Verify Phone Number ID + access token against Meta Graph API. */
export const testWhatsAppConnection = createServerFn({ method: "POST" }).handler(async () => {
  const cfg = await loadWhatsAppConfig();
  if (!cfg.phone_number_id || !cfg.access_token) {
    throw new Error("Save Phone Number ID and Access Token under Channels → WhatsApp first.");
  }

  const res = await fetch(
    `${GRAPH_BASE}/${cfg.phone_number_id}?fields=display_phone_number,verified_name,quality_rating`,
    {
      headers: { Authorization: `Bearer ${cfg.access_token}` },
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(json.error?.message || `Meta Graph error (${res.status})`);
  }

  // Persist display phone if Meta returns it and we don't have one
  if (json.display_phone_number && !cfg.display_phone) {
    const supabase = createServiceSupabase();
    await supabase
      .from("channels")
      .update({
        config: { ...cfg, display_phone: json.display_phone_number },
        detail: json.display_phone_number,
        status: "Connected",
        is_enabled: true,
        health: 100,
      })
      .eq("org_id", ORG_ID)
      .eq("type", "whatsapp");
  }

  return {
    ok: true as const,
    displayPhone: json.display_phone_number || cfg.display_phone || null,
    verifiedName: json.verified_name || null,
    qualityRating: json.quality_rating || null,
    webhookReady: Boolean(cfg.verify_token),
    needsPublicHttps: (() => {
      const appUrl = process.env.VITE_APP_URL || process.env.APP_URL || "";
      return !appUrl || /localhost|127\.0\.0\.1/i.test(appUrl);
    })(),
  };
});

/** Called from Inbox when an agent replies on a WhatsApp thread. */
export const sendWhatsAppAgentReply = createServerFn({ method: "POST" })
  .validator(
    z.object({
      conversationId: z.string().uuid(),
      body: z.string().min(1).max(4000),
    }),
  )
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const { data: convo, error } = await supabase
      .from("conversations")
      .select("id, channel, visitor_phone, metadata, widget_session_id, wa_last_customer_at")
      .eq("id", data.conversationId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!convo) throw new Error("Conversation not found");

    const { getWhatsAppWindow, isMarketplaceLeadChannel, normalizeWhatsAppDigits } =
      await import("@/lib/whatsapp-window");
    const channel = String(convo.channel || "");
    const marketplace = isMarketplaceLeadChannel(channel);
    if (channel !== "whatsapp" && !marketplace) {
      throw new Error("This conversation is not set up for WhatsApp outbound");
    }

    // Meta 24h window — free-form text only while open.
    // Marketplace threads: only real WA inbound (`wa_last_customer_at`) counts —
    // do not use the IndiaMART/TradeIndia enquiry message as a WhatsApp session start.
    let windowStart = (convo.wa_last_customer_at as string) || null;
    if (!windowStart && channel === "whatsapp") {
      const { data: lastCustomer } = await supabase
        .from("messages")
        .select("created_at")
        .eq("conversation_id", data.conversationId)
        .eq("sender", "customer")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      windowStart = (lastCustomer?.created_at as string) || null;
    }
    const win = getWhatsAppWindow(windowStart);
    if (!win.open) {
      throw new Error(
        marketplace
          ? "WhatsApp session not open yet. For first contact use Broadcasting (template) or Open WhatsApp from Inbox. After the customer replies on WhatsApp, free-form works for 24h."
          : "WhatsApp 24-hour window is closed. Send an approved template from Broadcasting, then wait for the customer to reply.",
      );
    }

    const meta = (convo.metadata || {}) as { wa_id?: string };
    const phone =
      normalizeWhatsAppDigits(meta.wa_id) ||
      normalizeWhatsAppDigits(convo.visitor_phone as string) ||
      normalizeWhatsAppDigits(String(convo.widget_session_id || "").replace(/^wa:/, ""));
    if (!phone) throw new Error("WhatsApp recipient phone missing on conversation");

    await sendWhatsAppText(phone, data.body);
    return { ok: true, window: win, via: marketplace ? channel : "whatsapp" };
  });

/** Inbox: recommend a catalog product as WhatsApp image + caption (Path B). */
export const sendWhatsAppProductRecommendation = createServerFn({ method: "POST" })
  .validator(
    z.object({
      conversationId: z.string().uuid(),
      productId: z.string().uuid(),
      profileId: z.string().uuid().optional(),
      assigneeLabel: z.string().max(120).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const { data: convo, error } = await supabase
      .from("conversations")
      .select("id, channel, visitor_phone, metadata, widget_session_id, wa_last_customer_at")
      .eq("id", data.conversationId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!convo) throw new Error("Conversation not found");

    const { getWhatsAppWindow, isMarketplaceLeadChannel, normalizeWhatsAppDigits } =
      await import("@/lib/whatsapp-window");
    const channel = String(convo.channel || "");
    const marketplace = isMarketplaceLeadChannel(channel);
    if (channel !== "whatsapp" && !marketplace) {
      throw new Error("Product recommendations send via WhatsApp — open a WhatsApp or marketplace thread with a phone");
    }

    let windowStart = (convo.wa_last_customer_at as string) || null;
    if (!windowStart && channel === "whatsapp") {
      const { data: lastCustomer } = await supabase
        .from("messages")
        .select("created_at")
        .eq("conversation_id", data.conversationId)
        .eq("sender", "customer")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      windowStart = (lastCustomer?.created_at as string) || null;
    }
    const win = getWhatsAppWindow(windowStart);
    if (!win.open) {
      throw new Error(
        "WhatsApp 24-hour window is closed. Send an approved template first, then recommend products after the customer replies.",
      );
    }

    const meta = (convo.metadata || {}) as { wa_id?: string };
    const phone =
      normalizeWhatsAppDigits(meta.wa_id) ||
      normalizeWhatsAppDigits(convo.visitor_phone as string) ||
      normalizeWhatsAppDigits(String(convo.widget_session_id || "").replace(/^wa:/, ""));
    if (!phone) throw new Error("WhatsApp recipient phone missing on conversation");

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("id", data.productId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (productError) throw new Error(productError.message);
    if (!product) throw new Error("Product not found");

    const { formatProductRecommendationCaption } = await import("@/lib/product-card");
    const caption = formatProductRecommendationCaption(product as import("@/lib/db-types").DbProduct);

    let imageUrl =
      (typeof product.image_url === "string" && product.image_url) ||
      (typeof product.image_path === "string" && product.image_path
        ? `${String(process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "")}/storage/v1/object/public/knowledge/${product.image_path}`
        : null);

    if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
      throw new Error("Product image URL must be public HTTPS (run 019 and upload an image on Products)");
    }

    if (imageUrl) {
      await sendWhatsAppImage({ toPhone: phone, imageUrl, caption });
    } else {
      await sendWhatsAppText(phone, caption);
    }

    const label = data.assigneeLabel?.trim() || "Human agent";
    const bodyPreview = imageUrl
      ? `📦 Recommended: ${product.name}\n${caption}`
      : `📦 Recommended: ${product.name} (text — add a product image for photo cards)\n${caption}`;

    await supabase.from("messages").insert({
      org_id: ORG_ID,
      conversation_id: data.conversationId,
      sender: "agent",
      sender_profile_id: data.profileId || null,
      body: bodyPreview.slice(0, 8000),
      metadata: {
        product_recommendation: true,
        product_id: product.id,
        product_name: product.name,
        image_url: imageUrl,
        caption,
      },
    });

    await supabase
      .from("conversations")
      .update({
        status: "human",
        ...(data.profileId
          ? { assignee_id: data.profileId, assignee_label: label }
          : { assignee_label: label }),
        unread_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.conversationId);

    return {
      ok: true,
      via: imageUrl ? "image" : "text",
      productName: product.name as string,
      window: win,
    };
  });
