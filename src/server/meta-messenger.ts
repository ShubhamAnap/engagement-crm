/**
 * Facebook Messenger + Instagram Messaging via Meta Graph API.
 * Shared Page access token pattern; separate channel rows in Supabase.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { generateOpenAiReply } from "@/server/openai";
import { agentReplyConfig, resolveAgentStack } from "@/server/agents";
import { resolveAgentToolKeys } from "@/server/ai-tools";
import { buildAnswerInspector } from "@/server/answer-inspector";
import { resolveCatalogueRequest, retrieveKnowledgeContext, formatKnowledgeContext, downloadLinksFromChunks, knowledgeIsUseful } from "@/server/knowledge";
import { wantsHumanHandoff, explicitLanguageRequest, languageSwitchAck, withHandoffMetadata } from "@/lib/conversation-guards";
import { humanWaitReplyForLang, sessionLangFromHistory, normalizeStoredLang, offTopicReplyForLang } from "@/lib/session-language";
import { isOffTopicMessage } from "@/lib/enertech-scope";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export type MetaMessengerType = "facebook" | "instagram";

export type MetaMessengerConfig = {
  page_id?: string;
  access_token?: string;
  verify_token?: string;
  /** Optional Instagram professional account id (for display) */
  ig_account_id?: string;
  page_name?: string;
};

function envConfig(type: MetaMessengerType): MetaMessengerConfig {
  const prefix = type === "instagram" ? "INSTAGRAM" : "FACEBOOK";
  return {
    page_id: process.env[`${prefix}_PAGE_ID`] || process.env.META_PAGE_ID || undefined,
    access_token: process.env[`${prefix}_ACCESS_TOKEN`] || process.env.META_PAGE_ACCESS_TOKEN || undefined,
    verify_token: process.env[`${prefix}_VERIFY_TOKEN`] || process.env.META_VERIFY_TOKEN || undefined,
    ig_account_id: process.env.INSTAGRAM_ACCOUNT_ID || undefined,
    page_name: process.env[`${prefix}_PAGE_NAME`] || undefined,
  };
}

export async function loadMetaConfig(type: MetaMessengerType): Promise<MetaMessengerConfig> {
  const fromEnv = envConfig(type);
  try {
    const supabase = createServiceSupabase();
    const { data } = await supabase
      .from("channels")
      .select("config, detail")
      .eq("org_id", ORG_ID)
      .eq("type", type)
      .maybeSingle();
    const cfg = ((data?.config as MetaMessengerConfig) || {}) as MetaMessengerConfig;
    return {
      page_id: cfg.page_id || fromEnv.page_id,
      access_token: cfg.access_token || fromEnv.access_token,
      verify_token: cfg.verify_token || fromEnv.verify_token,
      ig_account_id: cfg.ig_account_id || fromEnv.ig_account_id,
      page_name: cfg.page_name || fromEnv.page_name || (data?.detail as string) || undefined,
    };
  } catch {
    return fromEnv;
  }
}

export function metaConfigReady(cfg: MetaMessengerConfig): boolean {
  return Boolean(cfg.page_id && cfg.access_token && cfg.verify_token);
}

export async function sendMetaText(
  type: MetaMessengerType,
  recipientId: string,
  body: string,
  cfg?: MetaMessengerConfig,
) {
  const config = cfg || (await loadMetaConfig(type));
  if (!config.page_id || !config.access_token) {
    throw new Error(`${type} is not configured (missing page_id or access_token)`);
  }
  const to = recipientId.trim();
  if (!to) throw new Error("Invalid recipient id");

  const res = await fetch(`${GRAPH_BASE}/${config.page_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: to },
      messaging_type: "RESPONSE",
      message: { text: body.slice(0, 2000) },
    }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err =
      (json.error as { message?: string } | undefined)?.message ||
      `Meta ${type} API error (${res.status})`;
    throw new Error(err);
  }
  return json;
}

async function getChannelId(supabase: ReturnType<typeof createServiceSupabase>, type: MetaMessengerType) {
  const { data } = await supabase
    .from("channels")
    .select("id")
    .eq("org_id", ORG_ID)
    .eq("type", type)
    .maybeSingle();
  return data?.id as string | undefined;
}

async function findOrCreateMetaConversation(
  supabase: ReturnType<typeof createServiceSupabase>,
  type: MetaMessengerType,
  senderId: string,
  profileName?: string,
) {
  const prefix = type === "instagram" ? "ig" : "fb";
  const sessionKey = `${prefix}:${senderId}`;
  const tag = type === "instagram" ? "Instagram" : "Facebook";

  const { data: existing } = await supabase
    .from("conversations")
    .select("*")
    .eq("org_id", ORG_ID)
    .eq("channel", type)
    .eq("widget_session_id", sessionKey)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (profileName && !existing.visitor_name) patch.visitor_name = profileName;
    if (Object.keys(patch).length > 0) {
      await supabase.from("conversations").update(patch).eq("id", existing.id);
    }
    return existing;
  }

  const channelId = await getChannelId(supabase, type);
  const externalRef = `${prefix.toUpperCase()}-${senderId.slice(-6) || Date.now().toString().slice(-6)}`;

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      org_id: ORG_ID,
      channel_id: channelId || null,
      channel: type,
      external_ref: externalRef,
      subject: `${tag} chat`,
      status: "ai",
      assignee_label: "AI · Support Agent",
      visitor_name: profileName || `${tag} user`,
      widget_session_id: sessionKey,
      tags: [tag],
      unread_count: 0,
      metadata: { meta_sender_id: senderId, meta_channel: type },
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return created;
}

type MessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: { mid?: string; text?: string; is_echo?: boolean };
};

function extractMessagingEvents(payload: unknown): MessagingEvent[] {
  const root = payload as {
    entry?: Array<{
      messaging?: MessagingEvent[];
      changes?: Array<{ value?: { messaging?: MessagingEvent[]; messages?: unknown } }>;
    }>;
  };
  const events: MessagingEvent[] = [];
  for (const entry of root.entry || []) {
    if (entry.messaging?.length) events.push(...entry.messaging);
    for (const change of entry.changes || []) {
      if (change.value?.messaging?.length) events.push(...change.value.messaging);
    }
  }
  return events;
}

export async function handleMetaInboundPayload(type: MetaMessengerType, payload: unknown) {
  const supabase = createServiceSupabase();
  const cfg = await loadMetaConfig(type);
  const events = extractMessagingEvents(payload);
  const results: Array<{ conversationId: string; messageId: string }> = [];
  const msgMetaKey = type === "instagram" ? "ig_message_id" : "fb_message_id";

  for (const event of events) {
    if (event.message?.is_echo) continue;
    const from = event.sender?.id;
    const text = event.message?.text?.trim();
    const mid = event.message?.mid;
    if (!from || !text) continue;

    if (mid) {
      const { data: dup } = await supabase
        .from("messages")
        .select("id")
        .eq("org_id", ORG_ID)
        .filter(`metadata->>${msgMetaKey}`, "eq", mid)
        .limit(1)
        .maybeSingle();
      if (dup) continue;
    }

    const convo = await findOrCreateMetaConversation(supabase, type, from);

    const { data: customerMsg, error: msgError } = await supabase
      .from("messages")
      .insert({
        org_id: ORG_ID,
        conversation_id: convo.id,
        sender: "customer",
        body: text,
        metadata: { [msgMetaKey]: mid || null, meta_sender_id: from },
      })
      .select("*")
      .single();
    if (msgError) throw new Error(msgError.message);

    results.push({ conversationId: convo.id as string, messageId: customerMsg.id as string });

    const status = convo.status as string;
    const prevMetaLang =
      convo.metadata && typeof convo.metadata === "object"
        ? (convo.metadata as Record<string, unknown>)
        : {};
    const { data: langHist } = await supabase
      .from("messages")
      .select("sender, body")
      .eq("conversation_id", convo.id)
      .order("created_at", { ascending: true })
      .limit(24);
    const sessionLang = sessionLangFromHistory(
      text,
      langHist,
      normalizeStoredLang(prevMetaLang.preferred_lang),
    );

    if (wantsHumanHandoff(text)) {
      const wait = humanWaitReplyForLang(sessionLang);
      await supabase
        .from("conversations")
        .update({
          status: "escalated",
          assignee_label: "Human queue",
          preview: wait.slice(0, 160),
          metadata: withHandoffMetadata(
            { ...prevMetaLang, preferred_lang: sessionLang },
            "Customer requested human",
          ),
        })
        .eq("id", convo.id);
      await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: convo.id,
        sender: "ai",
        body: wait,
        metadata: { handoff: true, human_like_wait: true, lang: sessionLang },
      });
      try {
        await sendMetaText(type, from, wait, cfg);
      } catch (err) {
        console.error("meta handoff wait send failed", err);
      }
      try {
        const { fireAutomations } = await import("@/server/automation-engine");
        fireAutomations("conversation_escalated", { conversationId: convo.id as string });
      } catch (err) {
        console.error("escalation automation", err);
      }
      continue;
    }

    if (status === "human" || status === "escalated") {
      const switchTo = explicitLanguageRequest(text);
      if (switchTo) {
        const ack = languageSwitchAck(switchTo);
        await supabase
          .from("conversations")
          .update({
            metadata: { ...prevMetaLang, preferred_lang: switchTo },
            preview: ack.slice(0, 160),
          })
          .eq("id", convo.id);
        await supabase.from("messages").insert({
          org_id: ORG_ID,
          conversation_id: convo.id,
          sender: "ai",
          body: ack,
          metadata: { language_ack: true, lang: switchTo },
        });
        try {
          await sendMetaText(type, from, ack, cfg);
        } catch (err) {
          console.error("meta language ack failed", err);
        }
      }
      continue;
    }

    if (status === "resolved" || status === "closed") {
      continue;
    }

    let reply = "Thanks for messaging EnerTech. How can we help with your UPS needs?";
    let inspector = buildAnswerInspector({
      chunks: [],
      replySource: "fallback",
      model: "gpt-4o-mini",
      agentName: "EnerBot",
      channel: type,
    });
    try {
      const { data: history } = await supabase
        .from("messages")
        .select("sender, body, created_at")
        .eq("conversation_id", convo.id)
        .order("created_at", { ascending: true })
        .limit(20);
      const prevMeta =
        convo.metadata && typeof convo.metadata === "object"
          ? (convo.metadata as Record<string, unknown>)
          : {};
      const pendingCatalogue = Array.isArray(prevMeta.pending_catalogue_options)
        ? (prevMeta.pending_catalogue_options as Array<{
            documentId: string;
            label: string;
            title?: string;
            url?: string;
            fileName?: string;
          }>)
        : [];
      const catalogue = await resolveCatalogueRequest(text, { pendingOptions: pendingCatalogue });
      if (catalogue.mode === "clarify") {
        reply = catalogue.message;
        const nextMeta = {
          ...prevMeta,
          pending_catalogue_options: catalogue.clarifyOptions.map((o) => ({
            documentId: o.documentId,
            label: o.label,
            title: o.title,
            url: o.url,
            fileName: o.fileName,
          })),
        };
        await supabase.from("conversations").update({ metadata: nextMeta }).eq("id", convo.id);
        inspector = buildAnswerInspector({
          chunks: [],
          replySource: "openai",
          model: "gpt-4o-mini",
          agentName: "EnerBot",
          channel: type,
          downloadCount: 0,
        });
      } else if (catalogue.mode === "match") {
        const { sanitizeAssistantFileLinks, shortenDownloadLinks } = await import("@/server/shorten-urls");
        const downloadLinks = await shortenDownloadLinks(catalogue.downloads.slice(0, 1));
        reply = await sanitizeAssistantFileLinks("Here is the catalogue.", downloadLinks, {
          channel: "whatsapp",
        });
        const nextMeta = { ...prevMeta };
        if (!catalogue.fromPending) {
          delete nextMeta.pending_catalogue_options;
        }
        await supabase.from("conversations").update({ metadata: nextMeta }).eq("id", convo.id);
        inspector = buildAnswerInspector({
          chunks: [],
          replySource: "openai",
          model: "gpt-4o-mini",
          agentName: "EnerBot",
          channel: type,
          downloadCount: downloadLinks.length,
        });
      } else if (isOffTopicMessage(text, { conversationActive: true })) {
        reply = offTopicReplyForLang(sessionLang);
        inspector = buildAnswerInspector({
          chunks: [],
          replySource: "fallback",
          model: "gpt-4o-mini",
          agentName: "EnerBot",
          channel: type,
          downloadCount: 0,
        });
        (inspector.metadata as Record<string, unknown>).off_topic = true;
      } else {
      const [chunks] = await Promise.all([retrieveKnowledgeContext(text, 6)]);
      const stack = await resolveAgentStack({ channel: type, message: text });
      const agentCfg = agentReplyConfig(stack);
      const { sanitizeAssistantFileLinks } = await import("@/server/shorten-urls");
      const { buildProductsContextForAi } = await import("@/server/product-pack");
      const productsContext = await buildProductsContextForAi(text);
      const downloadLinks = downloadLinksFromChunks(chunks);
      const generated = await generateOpenAiReply({
        visitorName: (convo.visitor_name as string) || "Customer",
        latestUserMessage: text,
        history: (history || []).map((m) => ({
          sender: m.sender as string,
          body: m.body as string,
          created_at: m.created_at as string,
        })),
        knowledgeContext: formatKnowledgeContext(chunks),
        productsContext,
        downloadLinks,
        systemPrompt: agentCfg.systemPrompt,
        model: agentCfg.model,
        agentName: agentCfg.agentName,
        memoryEnabled: agentCfg.memoryEnabled,
        toolKeys: await resolveAgentToolKeys({ allowedOnAgent: agentCfg.allowedTools }),
        replyLanguage: sessionLang,
      });
      reply = await sanitizeAssistantFileLinks(generated.reply, downloadLinks, { channel: "whatsapp" });
      inspector = buildAnswerInspector({
        chunks,
        replySource: generated.source,
        model: generated.model,
        agentName: agentCfg.agentName,
        specialistKey: agentCfg.specialistKey,
        channel: type,
        visitorName: (convo.visitor_name as string) || "Customer",
        downloadCount: downloadLinks.length,
        memoryEnabled: agentCfg.memoryEnabled,
        productsUseful: knowledgeIsUseful(chunks) || Boolean(productsContext?.trim()),
      });
      if (agentCfg.agentId) {
        await supabase
          .from("conversations")
          .update({
            agent_id: agentCfg.agentId,
            assignee_label: agentCfg.assigneeLabel,
            metadata: {
              ...prevMeta,
              specialist_key: agentCfg.specialistKey,
              specialist_id: agentCfg.specialistId,
              meta_sender_id: from,
            },
          })
          .eq("id", convo.id);
      }
      }
    } catch (err) {
      console.error(`${type} AI reply failed`, err);
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
      await sendMetaText(type, from, reply, cfg);
    } catch (err) {
      console.error(`${type} outbound AI send failed`, err);
    }
  }

  return results;
}

const saveSchema = z.object({
  type: z.enum(["facebook", "instagram"]),
  pageId: z.string().min(1).max(80),
  accessToken: z.string().min(10).max(800),
  verifyToken: z.string().min(4).max(200),
  igAccountId: z.string().max(80).optional(),
  pageName: z.string().max(120).optional(),
  enable: z.boolean().optional(),
});

export const saveMetaChannelConfig = createServerFn({ method: "POST" })
  .validator(saveSchema)
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const config: MetaMessengerConfig = {
      page_id: data.pageId.trim(),
      access_token: data.accessToken.trim(),
      verify_token: data.verifyToken.trim(),
      ig_account_id: data.igAccountId?.trim() || undefined,
      page_name: data.pageName?.trim() || undefined,
    };
    const enable = data.enable ?? true;
    const label = data.type === "instagram" ? "Instagram Messaging" : "Facebook Messenger";
    const { data: updated, error } = await supabase
      .from("channels")
      .update({
        config,
        detail: config.page_name || `${label} · Page ${config.page_id}`,
        is_enabled: enable,
        status: enable ? "Connected" : "Disconnected",
        health: enable ? 100 : 0,
      })
      .eq("org_id", ORG_ID)
      .eq("type", data.type)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return {
      ok: true,
      channel: updated,
      webhookPath: `/api/webhooks/${data.type}`,
    };
  });

export const getMetaSetupInfo = createServerFn({ method: "GET" })
  .validator(z.object({ type: z.enum(["facebook", "instagram"]) }))
  .handler(async ({ data }) => {
    const cfg = await loadMetaConfig(data.type);
    const appUrl = process.env.VITE_APP_URL || process.env.APP_URL || "";
    const path = `/api/webhooks/${data.type}`;
    return {
      configured: metaConfigReady(cfg),
      pageId: cfg.page_id ? `${cfg.page_id.slice(0, 4)}…` : null,
      hasAccessToken: Boolean(cfg.access_token),
      verifyTokenSet: Boolean(cfg.verify_token),
      pageName: cfg.page_name || null,
      webhookUrl: appUrl ? `${appUrl.replace(/\/$/, "")}${path}` : path,
    };
  });

export const sendMetaAgentReply = createServerFn({ method: "POST" })
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
      .select("id, channel, metadata, widget_session_id")
      .eq("id", data.conversationId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!convo) throw new Error("Conversation not found");
    if (convo.channel !== "facebook" && convo.channel !== "instagram") {
      throw new Error("Not a Facebook/Instagram conversation");
    }

    const type = convo.channel as MetaMessengerType;
    const meta = (convo.metadata || {}) as { meta_sender_id?: string };
    const prefix = type === "instagram" ? "ig:" : "fb:";
    const recipient =
      meta.meta_sender_id || String(convo.widget_session_id || "").replace(new RegExp(`^${prefix}`), "");
    if (!recipient) throw new Error("Recipient id missing on conversation");

    await sendMetaText(type, recipient, data.body);
    return { ok: true };
  });
