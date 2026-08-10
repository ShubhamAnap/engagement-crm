import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { generateOpenAiReply } from "@/server/openai";
import { agentReplyConfig, resolveAgentStack } from "@/server/agents";
import { resolveAgentToolKeys } from "@/server/ai-tools";
import { buildAnswerInspector } from "@/server/answer-inspector";
import { isOffTopicMessage, isAckOnlyMessage, isGreetingOnlyMessage, isSoftCustomerAckMessage } from "@/lib/enertech-scope";
import {
  isEducateOnlyAsk,
  isRequirementConfirmAck,
  hasRecentRequirementContext,
  resolveActiveRequirement,
  extractPowerHint,
  requirementConfirmReply,
  isBlockedWhatsAppGreetingTemplate,
  isAllowedWhatsAppGreetingTemplateName,
  shouldSuppressColdGreeting,
  isColdConversationStart,
  resolveSalesOwnerGate,
  salesPersonDeferReply,
  isBusinessAutoReplyMessage,
} from "@/lib/conversation-intent";
import {
  wantsHumanHandoff,
  isServiceIntent,
  emptyServiceTicket,
  mergeServiceTicketFromText,
  nextServiceTicketPrompt,
  explicitLanguageRequest,
  languageSwitchAck,
  withHandoffMetadata,
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
import { ensureWhatsAppLeadCustomer } from "@/server/whatsapp-crm";
import { findReferenceImages, resolveCatalogueRequest, retrieveKnowledgeContext, wantsReferenceImages, customerAskedForMorePhotos, formatKnowledgeContext, downloadLinksFromChunks } from "@/server/knowledge";
import { resolveProductPackRequest, buildProductPackMedia, buildProductsContextForAi, isProductIntent } from "@/server/product-pack";

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

/** Meta Graph `messages[0].id` (wamid) from a successful send response. */
export function extractWhatsAppOutboundId(json: Record<string, unknown> | null | undefined): string | null {
  const messages = json?.messages as Array<{ id?: string }> | undefined;
  const id = messages?.[0]?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Download inbound WhatsApp media from Meta and store in public knowledge bucket
 * so Inbox can preview/play like WhatsApp Web.
 */
export async function downloadAndStoreWhatsAppMedia(options: {
  mediaId: string;
  conversationId: string;
  mediaKind: string;
  fileNameHint?: string | null;
  mimeHint?: string | null;
  cfg?: WhatsAppChannelConfig;
}): Promise<{ url: string; storagePath: string; mimeType: string; fileName: string } | null> {
  const config = options.cfg || (await loadWhatsAppConfig());
  if (!config.access_token) return null;

  const metaRes = await fetch(`${GRAPH_BASE}/${options.mediaId}`, {
    headers: { Authorization: `Bearer ${config.access_token}` },
  });
  const metaJson = (await metaRes.json().catch(() => ({}))) as {
    url?: string;
    mime_type?: string;
    error?: { message?: string };
  };
  if (!metaRes.ok || !metaJson.url) {
    console.error("WA media metadata failed", metaJson.error?.message || metaRes.status);
    return null;
  }

  const binRes = await fetch(metaJson.url, {
    headers: { Authorization: `Bearer ${config.access_token}` },
  });
  if (!binRes.ok) {
    console.error("WA media binary download failed", binRes.status);
    return null;
  }
  const buffer = Buffer.from(await binRes.arrayBuffer());
  const mimeType =
    (metaJson.mime_type || options.mimeHint || binRes.headers.get("content-type") || "application/octet-stream")
      .split(";")[0]
      .trim()
      .toLowerCase();

  const extFromMime =
    mimeType === "image/jpeg" || mimeType === "image/jpg"
      ? "jpg"
      : mimeType === "image/png"
        ? "png"
        : mimeType === "image/webp"
          ? "webp"
          : mimeType === "image/gif"
            ? "gif"
            : mimeType === "application/pdf"
              ? "pdf"
              : mimeType.includes("ogg")
                ? "ogg"
                : mimeType.includes("mpeg") || mimeType === "audio/mp3"
                  ? "mp3"
                  : mimeType.includes("mp4")
                    ? "mp4"
                    : mimeType.includes("3gpp")
                      ? "3gp"
                      : options.mediaKind === "sticker"
                        ? "webp"
                        : options.mediaKind === "audio"
                          ? "ogg"
                          : options.mediaKind === "video"
                            ? "mp4"
                            : options.mediaKind === "image"
                              ? "jpg"
                              : "bin";

  const rawName = (options.fileNameHint || `${options.mediaKind}.${extFromMime}`).replace(
    /[^\w.\-()+ ]+/g,
    "_",
  );
  const fileName = /\.[a-z0-9]+$/i.test(rawName) ? rawName.slice(0, 120) : `${rawName.slice(0, 100)}.${extFromMime}`;
  const storagePath = `chat/${ORG_ID}/${options.conversationId}/inbound-${Date.now()}-${fileName}`;

  const supabase = createServiceSupabase();
  try {
    const { ensureKnowledgeStorage } = await import("@/server/knowledge");
    await ensureKnowledgeStorage();
  } catch (err) {
    console.warn("ensureKnowledgeStorage (inbound media)", err);
  }

  const { error: uploadError } = await supabase.storage.from("knowledge").upload(storagePath, buffer, {
    contentType: mimeType,
    upsert: false,
  });
  if (uploadError) {
    console.error("WA media storage upload failed", uploadError.message);
    return null;
  }

  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const url = `${base.replace(/\/$/, "")}/storage/v1/object/public/knowledge/${storagePath}`;
  return { url, storagePath, mimeType, fileName };
}

const WA_STATUS_RANK: Record<string, number> = {
  failed: 0,
  pending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

/**
 * Meta delivery/read receipts — update message ticks ONLY.
 * Must never insert messages, bump unread, preview, or last_message_at.
 */
async function applyWhatsAppStatusUpdates(
  supabase: ReturnType<typeof createServiceSupabase>,
  statuses: Array<{
    id?: string;
    status?: string;
    timestamp?: string;
    errors?: Array<{ message?: string; code?: number }>;
  }>,
) {
  for (const st of statuses) {
    const wamid = st.id;
    const status = String(st.status || "").toLowerCase();
    if (!wamid || !status) continue;
    if (!["sent", "delivered", "read", "failed"].includes(status)) continue;

    const { data: row } = await supabase
      .from("messages")
      .select("id, metadata")
      .eq("org_id", ORG_ID)
      .filter("metadata->>wa_message_id", "eq", wamid)
      .limit(1)
      .maybeSingle();
    if (!row) continue;

    const meta = ((row.metadata || {}) as Record<string, unknown>) || {};
    const prev = String(meta.wa_status || "").toLowerCase();
    const prevRank = WA_STATUS_RANK[prev] ?? -1;
    const nextRank = WA_STATUS_RANK[status] ?? -1;
    if (status !== "failed" && nextRank <= prevRank) continue;

    const nextMeta: Record<string, unknown> = {
      ...meta,
      wa_status: status,
      wa_status_at: st.timestamp
        ? new Date(Number(st.timestamp) * 1000).toISOString()
        : new Date().toISOString(),
    };
    if (status === "failed") {
      nextMeta.wa_error = st.errors?.[0]?.message || "failed";
    }

    // Message row only — never touch conversations (no "chat activity" from read/seen).
    await supabase.from("messages").update({ metadata: nextMeta }).eq("id", row.id);
  }
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

/** Send a PDF/catalogue as a native WhatsApp document (opens in-app — no mobile browser). */
export async function sendWhatsAppDocument(options: {
  toPhone: string;
  documentUrl: string;
  fileName: string;
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
  if (!/^https:\/\//i.test(options.documentUrl)) {
    throw new Error("Document must be a public HTTPS URL for WhatsApp");
  }

  const fileName = (options.fileName || "document.pdf")
    .replace(/[\\/]+/g, "-")
    .replace(/[^\w.\- ()]+/g, "_")
    .slice(0, 200);
  const safeName = /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`;

  const res = await fetch(`${GRAPH_BASE}/${config.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        link: options.documentUrl,
        filename: safeName,
        ...(options.caption ? { caption: options.caption.slice(0, 1024) } : {}),
      },
    }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err =
      (json.error as { message?: string } | undefined)?.message ||
      `WhatsApp document API error (${res.status})`;
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

export async function findOrCreateWhatsAppConversation(
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

/** When 24h window was closed on a cold start, welcome via approved template only (never Meta samples). */
async function sendGreetingTemplateFallback(options: {
  supabase: ReturnType<typeof createServiceSupabase>;
  toPhone: string;
  conversationId: string;
  visitorName?: string | null;
  cfg: WhatsAppChannelConfig;
}): Promise<boolean> {
  const envName = (process.env.WHATSAPP_GREETING_TEMPLATE_NAME || "").trim();
  if (envName && isBlockedWhatsAppGreetingTemplate(envName)) {
    console.warn("WHATSAPP_GREETING_TEMPLATE_NAME is a blocked Meta sample — skipping template greeting", envName);
    return false;
  }

  const { data: rows } = await options.supabase
    .from("wa_message_templates")
    .select("name, language, status, body_text")
    .eq("org_id", ORG_ID)
    .order("updated_at", { ascending: false })
    .limit(40);

  const approved = ((rows || []) as Array<{
    name: string;
    language?: string;
    status?: string;
    body_text?: string | null;
  }>).filter((t) => /approved/i.test(String(t.status || "")));

  const pool = approved.filter((t) => !isBlockedWhatsAppGreetingTemplate(t.name));
  const hit =
    (envName ? pool.find((t) => t.name === envName) : null) ||
    pool.find((t) => isAllowedWhatsAppGreetingTemplateName(t.name)) ||
    null;

  if (!hit?.name) return false;

  try {
    const { sendWhatsAppTemplateMessage, logWhatsAppTemplateSendToInbox } = await import(
      "@/server/whatsapp-broadcast"
    );
    const waId = await sendWhatsAppTemplateMessage({
      toPhone: options.toPhone,
      templateName: hit.name,
      language: hit.language || "en",
      cfg: options.cfg,
    });
    await logWhatsAppTemplateSendToInbox({
      conversationId: options.conversationId,
      phone: options.toPhone,
      visitorName: options.visitorName,
      templateName: hit.name,
      language: hit.language || "en",
      waMessageId: waId,
      sender: "ai",
      automation: false,
      extraMetadata: { greeting: true, greeting_mode: "template" },
    });
    return true;
  } catch (err) {
    console.error("WhatsApp greeting template failed", err);
    return false;
  }
}

function isHumanOwnedConversation(c: {
  status?: string | null;
  assignee_id?: string | null;
  assignee_label?: string | null;
}): boolean {
  const status = String(c.status || "");
  if (status === "human" || status === "escalated") return true;
  if (c.assignee_id) return true;
  const label = String(c.assignee_label || "").toLowerCase();
  if (!label) return false;
  if (/\bai\b/.test(label) || label.includes("enerbot") || label.includes("bot")) return false;
  if (label.includes("human queue")) return true;
  // Named agent / admin assignee without AI marker
  if (!/support agent/.test(label) && label.length > 1) return true;
  return false;
}

type WaInboundMsg = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  image?: { id?: string; caption?: string; mime_type?: string };
  document?: { id?: string; filename?: string; caption?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; caption?: string; mime_type?: string };
  sticker?: { id?: string };
};

const WA_MEDIA_TYPES = new Set(["image", "document", "audio", "video", "sticker"]);

/** Extract customer-visible text from WhatsApp button / list replies. */
function extractWhatsAppInteractiveText(msg: WaInboundMsg): string | null {
  const type = String(msg.type || "");
  if (type === "button") {
    const t = msg.button?.text?.trim() || msg.button?.payload?.trim();
    return t || null;
  }
  if (type === "interactive") {
    const br = msg.interactive?.button_reply?.title?.trim();
    if (br) return br;
    const lr =
      msg.interactive?.list_reply?.title?.trim() ||
      msg.interactive?.list_reply?.description?.trim();
    if (lr) return lr;
  }
  return null;
}

export async function handleWhatsAppInboundPayload(payload: unknown) {
  const supabase = createServiceSupabase();
  const cfg = await loadWhatsAppConfig();
  const root = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
          messages?: WaInboundMsg[];
          statuses?: Array<{
            id?: string;
            status?: string;
            timestamp?: string;
            recipient_id?: string;
            errors?: Array<{ message?: string; code?: number }>;
          }>;
        };
      }>;
    }>;
  };

  const results: Array<{ conversationId: string; messageId: string }> = [];

  for (const entry of root.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;

      // Delivery / read / seen — ticks only. Do NOT open or bump conversations.
      if (value.statuses?.length) {
        try {
          await applyWhatsAppStatusUpdates(supabase, value.statuses);
        } catch (err) {
          console.error("WA status update failed", err);
        }
      }

      if (!value.messages?.length) continue;
      const contactName = value.contacts?.[0]?.profile?.name;

      for (const msg of value.messages) {
        const msgType = String(msg.type || "text");
        const from = msg.from;
        if (!from) continue;

        // Button / list reply → treat as text (never as a "file")
        const interactiveText = extractWhatsAppInteractiveText(msg);
        if (msgType === "button" || msgType === "interactive") {
          const convo = await findOrCreateWhatsAppConversation(supabase, from, contactName);
          try {
            await ensureWhatsAppLeadCustomer(supabase, convo as never, from, contactName);
          } catch (err) {
            console.error("WA CRM link failed", err);
          }
          const body = (interactiveText || "Customer tapped a button").trim();
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
          const { data: customerMsg, error: msgError } = await supabase
            .from("messages")
            .insert({
              org_id: ORG_ID,
              conversation_id: convo.id,
              sender: "customer",
              body,
              metadata: {
                wa_message_id: msg.id || null,
                wa_from: from,
                wa_type: msgType,
                interactive: true,
                button_payload: msg.button?.payload || msg.interactive?.button_reply?.id || null,
              },
            })
            .select("*")
            .single();
          if (msgError) throw new Error(msgError.message);

          const nowIso = new Date().toISOString();
          const unread = Number(convo.unread_count || 0) + 1;
          await supabase
            .from("conversations")
            .update({
              wa_last_customer_at: nowIso,
              last_message_at: nowIso,
              preview: body.slice(0, 160),
              unread_count: unread,
              updated_at: nowIso,
            })
            .eq("id", convo.id);

          results.push({
            conversationId: convo.id as string,
            messageId: customerMsg.id as string,
          });

          // Button tap saved for Inbox — never send "received your file".
          // Soft thanks / "thank you for update" → silent (no bot reply).
          continue;
        } else if (msgType !== "text" && WA_MEDIA_TYPES.has(msgType)) {
          // Real media — download to storage, preview in Inbox, open 24h window
          const convo = await findOrCreateWhatsAppConversation(supabase, from, contactName);
          try {
            await ensureWhatsAppLeadCustomer(supabase, convo as never, from, contactName);
          } catch (err) {
            console.error("WA CRM link failed", err);
          }
          const mediaKind = msgType;
          const caption =
            msg.image?.caption ||
            msg.document?.caption ||
            msg.video?.caption ||
            "";
          const fileHint =
            msg.document?.filename ||
            (mediaKind === "audio" ? "voice note" : mediaKind === "image" ? "photo" : mediaKind);
          const previewLabel =
            mediaKind === "image"
              ? "📷 Photo"
              : mediaKind === "document"
                ? `📄 ${msg.document?.filename || "Document"}`
                : mediaKind === "audio"
                  ? "🎤 Voice note"
                  : mediaKind === "video"
                    ? "🎬 Video"
                    : mediaKind === "sticker"
                      ? "Sticker"
                      : "Attachment";
          const body = caption ? `${previewLabel}\n${caption}` : previewLabel;
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

          const mediaId =
            msg.image?.id ||
            msg.document?.id ||
            msg.audio?.id ||
            msg.video?.id ||
            msg.sticker?.id ||
            null;
          const mimeHint =
            msg.image?.mime_type ||
            msg.document?.mime_type ||
            msg.audio?.mime_type ||
            msg.video?.mime_type ||
            null;

          let stored: Awaited<ReturnType<typeof downloadAndStoreWhatsAppMedia>> = null;
          if (mediaId) {
            try {
              stored = await downloadAndStoreWhatsAppMedia({
                mediaId,
                conversationId: convo.id as string,
                mediaKind,
                fileNameHint: msg.document?.filename || fileHint,
                mimeHint,
                cfg,
              });
            } catch (err) {
              console.error("WA media download/store failed", err);
            }
          }

          const { data: customerMsg, error: mediaInsertErr } = await supabase
            .from("messages")
            .insert({
              org_id: ORG_ID,
              conversation_id: convo.id,
              sender: "customer",
              body,
              metadata: {
                wa_message_id: msg.id || null,
                wa_from: from,
                media_type: mediaKind,
                media_id: mediaId,
                attachment: Boolean(stored?.url),
                file_name: stored?.fileName || msg.document?.filename || null,
                mime_type: stored?.mimeType || mimeHint,
                storage_path: stored?.storagePath || null,
                url: stored?.url || null,
              },
            })
            .select("id")
            .single();
          if (mediaInsertErr) throw new Error(mediaInsertErr.message);

          const nowIso = new Date().toISOString();
          const unread = Number(convo.unread_count || 0) + 1;
          await supabase
            .from("conversations")
            .update({
              wa_last_customer_at: nowIso,
              last_message_at: nowIso,
              preview: body.slice(0, 160),
              unread_count: unread,
              updated_at: nowIso,
            })
            .eq("id", convo.id);

          if (customerMsg?.id) {
            results.push({
              conversationId: convo.id as string,
              messageId: customerMsg.id as string,
            });
          }

          if (mediaKind === "sticker") continue;

          // Keep media ack minimal — no long "received your file / type model" scripts.
          const outboundAck = "Okay sir.";
          let ackWamid: string | null = null;
          try {
            const ackJson = await sendWhatsAppText(from, outboundAck, cfg);
            ackWamid = extractWhatsAppOutboundId(ackJson as Record<string, unknown>);
          } catch (err) {
            console.error("WA media ack failed", err);
          }
          await supabase.from("messages").insert({
            org_id: ORG_ID,
            conversation_id: convo.id,
            sender: "ai",
            body: outboundAck,
            metadata: {
              media_ack: true,
              media_type: mediaKind,
              ...(ackWamid ? { wa_message_id: ackWamid, wa_status: "sent" } : {}),
            },
          });
          continue;
        } else if (msgType !== "text") {
          // reaction / location / contacts / unknown — ignore quietly (no file ack)
          continue;
        }

        const text = msg.text?.body?.trim();
        if (!from || !text) continue;

        // Soft thanks also on plain text (parity with buttons)
        // (handled later via isAckOnlyMessage / shouldSuppress — also gate soft update acks early after insert)

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

        // Plain-text soft thanks / "thank you for update" — save only
        if (isSoftCustomerAckMessage(text) || isAckOnlyMessage(text)) {
          continue;
        }

        const previousWaLast =
          (convo.wa_last_customer_at as string | null | undefined) || null;

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
        const prevMetaEsc =
          convo.metadata && typeof convo.metadata === "object"
            ? (convo.metadata as Record<string, unknown>)
            : {};

        // Fresh ownership — avoid greeting/AI after human takeover (stale convo row)
        let ownedByHuman = isHumanOwnedConversation(convo as never);
        try {
          const { data: freshOwn } = await supabase
            .from("conversations")
            .select("status, assignee_id, assignee_label")
            .eq("id", convo.id)
            .maybeSingle();
          if (freshOwn) {
            ownedByHuman = isHumanOwnedConversation(freshOwn as never);
          }
        } catch {
          /* keep stale */
        }

        // Recent customer lines for session language (before full AI path)
        const { data: langHist } = await supabase
          .from("messages")
          .select("sender, body")
          .eq("conversation_id", convo.id)
          .order("created_at", { ascending: true })
          .limit(24);
        const sessionLang = sessionLangFromHistory(
          text,
          langHist,
          normalizeStoredLang(prevMetaEsc.preferred_lang),
        );

        // Persist detected language on every inbound
        if (prevMetaEsc.preferred_lang !== sessionLang) {
          await supabase
            .from("conversations")
            .update({ metadata: { ...prevMetaEsc, preferred_lang: sessionLang } })
            .eq("id", convo.id);
          prevMetaEsc.preferred_lang = sessionLang;
        }

        const escalate = wantsHumanHandoff(text);
        if (escalate) {
          const wait = humanWaitReplyForLang(sessionLang);
          await supabase
            .from("conversations")
            .update({
              status: "escalated",
              assignee_label: "Human queue",
              metadata: withHandoffMetadata(
                { ...prevMetaEsc, preferred_lang: sessionLang },
                "Customer requested human",
              ),
              preview: wait.slice(0, 160),
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
            await sendWhatsAppText(from, wait, cfg);
          } catch (err) {
            console.error("WA handoff wait send failed", err);
          }
          try {
            const { fireAutomations } = await import("@/server/automation-engine");
            fireAutomations("conversation_escalated", { conversationId: convo.id as string });
          } catch (err) {
            console.error("escalation automation", err);
          }
          continue;
        }

        try {
          await ensureWhatsAppLeadCustomer(supabase, convo as never, from, contactName);
        } catch (err) {
          console.error("WA CRM link failed", err);
        }

        // Human / escalated / assigned agent: store customer msg only (language switch ack allowed)
        if (ownedByHuman || status === "human" || status === "escalated") {
          const switchTo = explicitLanguageRequest(text);
          if (switchTo) {
            const ack = languageSwitchAck(switchTo);
            await supabase
              .from("conversations")
              .update({
                metadata: { ...prevMetaEsc, preferred_lang: switchTo },
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
              await sendWhatsAppText(from, ack, cfg);
            } catch (err) {
              console.error("WA language ack send failed", err);
            }
          }
          continue;
        }

        if (status === "resolved" || status === "closed") {
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
            .limit(40);

          const prevMeta =
            convo.metadata && typeof convo.metadata === "object"
              ? (convo.metadata as Record<string, unknown>)
              : {};

          const historyRows = (history || []).map((m) => ({
            sender: m.sender as string,
            body: m.body as string,
            created_at: m.created_at as string,
          }));

          // Lead requirement for memory (same phone / linked lead)
          let leadRequirement: string | null = null;
          try {
            const leadId =
              (convo as { lead_id?: string | null }).lead_id ||
              (typeof prevMeta.lead_id === "string" ? prevMeta.lead_id : null);
            if (leadId) {
              const { data: lead } = await supabase
                .from("leads")
                .select("requirement, product_label")
                .eq("id", leadId)
                .eq("org_id", ORG_ID)
                .maybeSingle();
              leadRequirement =
                (lead?.requirement as string) ||
                (lead?.product_label as string) ||
                null;
            } else {
              const { normalizeWhatsAppDigits } = await import("@/lib/whatsapp-window");
              const digits = normalizeWhatsAppDigits(from);
              if (digits) {
                const last10 = digits.slice(-10);
                const { data: lead } = await supabase
                  .from("leads")
                  .select("requirement, product_label, phone")
                  .eq("org_id", ORG_ID)
                  .not("phone", "is", null)
                  .order("updated_at", { ascending: false })
                  .limit(80);
                const hit = (lead || []).find((row) => {
                  const p = normalizeWhatsAppDigits(row.phone as string);
                  return Boolean(p && (p === digits || p.endsWith(last10) || digits.endsWith(p.slice(-10))));
                });
                leadRequirement =
                  (hit?.requirement as string) || (hit?.product_label as string) || null;
              }
            }
          } catch (err) {
            console.error("WA lead requirement lookup failed", err);
          }

          // Sales-owned requirement (requirement_submitted + assigned rep): history-first
          const salesGate = resolveSalesOwnerGate({ text, history: historyRows });
          if (salesGate.action === "silent") {
            continue;
          }
          if (salesGate.action === "defer") {
            reply = salesPersonDeferReply({
              lang: sessionLang,
              salesName: salesGate.salesName,
              salesPhone: salesGate.salesPhone,
              requirement: salesGate.requirement || leadRequirement,
            });
            await supabase.from("messages").insert({
              org_id: ORG_ID,
              conversation_id: convo.id,
              sender: "ai",
              body: reply,
              metadata: {
                sales_owner_defer: true,
                sales_name: salesGate.salesName,
                sales_phone: salesGate.salesPhone,
                requirement: salesGate.requirement || leadRequirement,
              },
            });
            try {
              await sendWhatsAppText(from, reply, cfg);
            } catch (err) {
              console.error("WA sales-owner defer send failed", err);
            }
            continue;
          }

          // Partner business auto-reply — never off-topic refuse
          if (isBusinessAutoReplyMessage(text)) {
            continue;
          }

          // "ok" / "thanks" / soft "hi" on an active sales thread — save only, no bot reply
          if (
            shouldSuppressColdGreeting({
              text,
              history: historyRows,
              leadRequirement,
              isGreeting: isGreetingOnlyMessage(text),
              isAck: isAckOnlyMessage(text),
            })
          ) {
            continue;
          }

          if (isAckOnlyMessage(text)) {
            continue;
          }

          // "Yes. 30kVA" after requirement template → confirm prior context, no product dump
          if (
            isRequirementConfirmAck(text) &&
            hasRecentRequirementContext(historyRows, leadRequirement)
          ) {
            const requirement = resolveActiveRequirement({
              history: historyRows,
              leadRequirement,
            });
            reply = requirementConfirmReply({
              lang: sessionLang,
              requirement,
              powerHint: extractPowerHint(text),
            });
            await supabase.from("messages").insert({
              org_id: ORG_ID,
              conversation_id: convo.id,
              sender: "ai",
              body: reply,
              metadata: {
                requirement_confirm: true,
                requirement: requirement || null,
                power_hint: extractPowerHint(text),
              },
            });
            try {
              await sendWhatsAppText(from, reply, cfg);
            } catch (err) {
              console.error("WA requirement confirm send failed", err);
            }
            continue;
          }

          // Cold-start greeting only — never Meta hello_world; template only when window was closed
          if (isGreetingOnlyMessage(text)) {
            if (!isColdConversationStart(historyRows)) {
              continue;
            }

            const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const { data: priorGreet } = await supabase
              .from("messages")
              .select("id")
              .eq("conversation_id", convo.id)
              .eq("sender", "ai")
              .gte("created_at", since)
              .filter("metadata->>greeting", "eq", "true")
              .limit(1)
              .maybeSingle();
            if (priorGreet) {
              continue;
            }

            const { getWhatsAppWindow } = await import("@/lib/whatsapp-window");
            const prevWin = getWhatsAppWindow(previousWaLast);
            reply = greetingReplyForLang(sessionLang);

            if (prevWin.open) {
              await supabase.from("messages").insert({
                org_id: ORG_ID,
                conversation_id: convo.id,
                sender: "ai",
                body: reply,
                metadata: { greeting: true, greeting_mode: "free_text" },
              });
              try {
                await sendWhatsAppText(from, reply, cfg);
              } catch (err) {
                console.error("WhatsApp greeting send failed", err);
              }
            } else {
              const sentTpl = await sendGreetingTemplateFallback({
                supabase,
                toPhone: from,
                conversationId: convo.id as string,
                visitorName: (convo.visitor_name as string) || contactName || null,
                cfg,
              });
              if (!sentTpl) {
                // Prefer short free-text welcome over a wrong / sample template
                await supabase.from("messages").insert({
                  org_id: ORG_ID,
                  conversation_id: convo.id,
                  sender: "ai",
                  body: reply,
                  metadata: { greeting: true, greeting_mode: "free_text_fallback" },
                });
                try {
                  await sendWhatsAppText(from, reply, cfg);
                } catch (err) {
                  console.error("WhatsApp greeting fallback send failed", err);
                }
              }
            }
            continue;
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

          const educateOnly = isEducateOnlyAsk(text);

          // Stale "which catalogue?" state must not hijack definition questions
          if (educateOnly && (pendingCatalogue.length || pendingProducts.length)) {
            const cleaned = { ...prevMeta };
            delete cleaned.pending_catalogue_options;
            delete cleaned.pending_product_options;
            await supabase.from("conversations").update({ metadata: cleaned }).eq("id", convo.id);
            Object.assign(prevMeta, cleaned);
          }

          const productPack = educateOnly
            ? { mode: "none" as const }
            : await resolveProductPackRequest(text, {
                pendingProducts,
                presentation: "whatsapp",
              });
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
            await supabase.from("conversations").update({ metadata: nextMeta }).eq("id", convo.id);

            const media =
              productPack.mode === "match" ? buildProductPackMedia(productPack.products) : [];
            reply =
              productPack.mode === "clarify"
                ? productPack.message
                : media.length === 1
                  ? "Here is the product details."
                  : "Here are the matching products.";

            inspector = buildAnswerInspector({
              chunks: [],
              replySource: "openai",
              model: "gpt-4o-mini",
              agentName: "EnerBot",
              channel: "whatsapp",
              visitorName: (convo.visitor_name as string) || contactName || "WhatsApp customer",
              downloadCount: media.filter((m) => m.catalogueUrl).length,
              memoryEnabled: true,
            });
            (inspector.metadata as Record<string, unknown>).product_pack = true;
            (inspector.metadata as Record<string, unknown>).product_pack_mode = productPack.mode;
            (inspector.metadata as Record<string, unknown>).product_ids = productPack.products.map(
              (p) => p.id,
            );
            (inspector.metadata as Record<string, unknown>).reference_images = media
              .filter((m) => m.imageUrl)
              .map((m) => ({
                url: m.imageUrl,
                title: "Product photo",
                file_name: `${m.productName}.jpg`,
              }));
            (inspector.metadata as Record<string, unknown>).download_links = media
              .filter((m) => m.catalogueUrl)
              .map((m) => ({
                title: "Catalogue",
                url: m.catalogueUrl,
                file_name: m.catalogueFileName || "catalogue.pdf",
              }));

            await supabase.from("messages").insert({
              org_id: ORG_ID,
              conversation_id: convo.id,
              sender: "ai",
              body:
                productPack.mode === "clarify"
                  ? productPack.message
                  : media.map((m) => m.caption).join("\n\n---\n\n").slice(0, 8000) || reply,
              confidence: inspector.confidence,
              sources: inspector.sources,
              metadata: inspector.metadata,
            });

            try {
              if (productPack.mode === "clarify") {
                await sendWhatsAppText(from, productPack.message, cfg);
              } else {
                await sendWhatsAppText(from, reply, cfg);
                for (const item of media.slice(0, 3)) {
                  if (item.imageUrl && /^https:\/\//i.test(item.imageUrl)) {
                    try {
                      await sendWhatsAppImage({
                        toPhone: from,
                        imageUrl: item.imageUrl,
                        caption: item.caption,
                        cfg,
                      });
                    } catch (err) {
                      console.error("WA product image send failed", err);
                      try {
                        await sendWhatsAppText(from, item.caption, cfg);
                      } catch (err2) {
                        console.error("WA product caption fallback failed", err2);
                      }
                    }
                  } else {
                    try {
                      await sendWhatsAppText(from, item.caption, cfg);
                    } catch (err) {
                      console.error("WA product text send failed", err);
                    }
                  }
                  if (item.catalogueUrl && /^https:\/\//i.test(item.catalogueUrl)) {
                    try {
                      await sendWhatsAppDocument({
                        toPhone: from,
                        documentUrl: item.catalogueUrl,
                        fileName: item.catalogueFileName || "catalogue.pdf",
                        caption: "Catalogue",
                        cfg,
                      });
                    } catch (err) {
                      console.error("WA product catalogue send failed", err);
                    }
                  }
                }
              }
            } catch (err) {
              console.error("WhatsApp product pack send failed", err);
            }
            continue;
          }

          // Product intent but no Products row: answer from Knowledge Base + catalogue context (never generic greeting)
          if (isProductIntent(text)) {
            const [chunks, productsContext] = await Promise.all([
              retrieveKnowledgeContext(text, 8),
              buildProductsContextForAi(text, 10),
            ]);
            const knowledgeContext = formatKnowledgeContext(chunks);
            const stack = await resolveAgentStack({ channel: "whatsapp", message: text });
            const agentCfg = agentReplyConfig(stack);
            const { sanitizeAssistantFileLinks } = await import("@/server/shorten-urls");
            const downloadLinks = downloadLinksFromChunks(chunks);
            const generated = await generateOpenAiReply({
              visitorName: (convo.visitor_name as string) || contactName || "WhatsApp customer",
              latestUserMessage: text,
              history: (history || []).map((m) => ({
                sender: m.sender as string,
                body: m.body as string,
                created_at: m.created_at as string,
              })),
              knowledgeContext,
              productsContext,
              downloadLinks,
              referenceImages: [],
              systemPrompt: [
                agentCfg.systemPrompt,
                "Customer asked about a product (kW / category / home-residential). Answer helpfully using Products catalogue + Knowledge Base.",
                "Give product name if known, about 4–5 clear features, and price if in context. Do not ask for name/phone. Do not send a generic welcome line.",
              ].join("\n"),
              model: agentCfg.model,
              agentName: agentCfg.agentName,
              memoryEnabled: agentCfg.memoryEnabled,
              toolKeys: await resolveAgentToolKeys({ allowedOnAgent: agentCfg.allowedTools }),
              replyLanguage: sessionLang,
            });
            reply = await sanitizeAssistantFileLinks(generated.reply, downloadLinks, { channel: "whatsapp" });
            if (!reply?.trim() || /thanks for messaging enertech/i.test(reply)) {
              reply =
                sessionLang === "hi" || sessionLang === "mixed"
                  ? "Sir, aapke kW / product ke hisaab se EnerTech solar hybrid / HF range suitable hai. Main features Knowledge Base se share karta hoon — model ya residential/commercial confirm karein to exact catalogue + price bhej dunga."
                  : "For that kW / use-case, EnerTech solar hybrid / HF range is typically suitable. I can share key features from our datasheets — confirm model or residential/commercial and I’ll send the exact catalogue and price.";
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
            productsUseful: isProductIntent(text) && Boolean(productsContext?.trim()),
            });
            (inspector.metadata as Record<string, unknown>).product_kb_fallback = true;
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
              console.error("WA product KB fallback send failed", err);
            }
            continue;
          }

          const catalogue = educateOnly
            ? { mode: "none" as const, downloads: [] as [], clarifyOptions: [] as [], message: "" }
            : await resolveCatalogueRequest(text, {
                pendingOptions: pendingCatalogue,
              });

          // Short catalogue path — skip long AI essays; send 0–1 PDF only
          if (catalogue.mode === "clarify" || catalogue.mode === "match") {
            const { shortenDownloadLinks } = await import("@/server/shorten-urls");
            const downloadLinks =
              catalogue.mode === "match"
                ? await shortenDownloadLinks(catalogue.downloads.slice(0, 1))
                : [];
            reply =
              catalogue.mode === "match"
                ? "Here is the catalogue."
                : catalogue.message || "Which catalogue do you need?";

            inspector = buildAnswerInspector({
              chunks: [],
              replySource: "openai",
              model: "gpt-4o-mini",
              agentName: "EnerBot",
              channel: "whatsapp",
              visitorName: (convo.visitor_name as string) || contactName || "WhatsApp customer",
              downloadCount: downloadLinks.length,
              memoryEnabled: true,
            });
            (inspector.metadata as Record<string, unknown>).download_links = downloadLinks.map((l) => ({
              title: l.title,
              url: l.url,
              file_name: l.fileName || l.title,
            }));
            (inspector.metadata as Record<string, unknown>).catalogue_mode = catalogue.mode;

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
              // Keep the numbered list so customer can reply 2, 3, … for another PDF
            } else if (catalogue.mode === "match") {
              delete nextMeta.pending_catalogue_options;
            }
            await supabase
              .from("conversations")
              .update({ metadata: nextMeta })
              .eq("id", convo.id);

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

            for (const link of downloadLinks.slice(0, 1)) {
              const docUrl = String(link.url || "").trim();
              if (!/^https:\/\//i.test(docUrl)) continue;
              const fileName = String(link.fileName || link.title || "datasheet.pdf");
              try {
                await sendWhatsAppDocument({
                  toPhone: from,
                  documentUrl: docUrl,
                  fileName,
                  caption: "Catalogue",
                  cfg,
                });
                await supabase.from("messages").insert({
                  org_id: ORG_ID,
                  conversation_id: convo.id,
                  sender: "ai",
                  body: `Catalogue PDF: ${fileName}\n${docUrl}`,
                  metadata: {
                    attachment: true,
                    catalogue: true,
                    url: docUrl,
                    file_name: fileName,
                    mime_type: "application/pdf",
                    document_id: link.documentId || null,
                  },
                });
              } catch (err) {
                console.error("WhatsApp catalogue document send failed", err);
              }
            }
            continue;
          }

          // Service ticket intake (structured after-sales)
          const existingTicket = (prevMeta.service_ticket as ServiceTicket | undefined) || null;
          if (isServiceIntent(text) || (existingTicket && existingTicket.status === "collecting")) {
            const base = existingTicket || emptyServiceTicket();
            const ticket = mergeServiceTicketFromText(base, text);
            const tags = Array.isArray((convo as { tags?: string[] }).tags)
              ? [...((convo as { tags?: string[] }).tags || [])]
              : [];
            if (!tags.includes("Service")) tags.push("Service");
            const nextMeta: Record<string, unknown> = {
              ...prevMeta,
              service_ticket: ticket,
            };
            delete nextMeta.pending_catalogue_options;
            reply = nextServiceTicketPrompt(ticket, sessionLang);
            if (ticket.status === "ready") {
              nextMeta.service_ticket = { ...ticket, status: "handed_off" };
              await supabase
                .from("conversations")
                .update({
                  metadata: withHandoffMetadata(nextMeta, "Service ticket ready"),
                  tags,
                  status: "escalated",
                  assignee_label: "Human queue",
                  preview: reply.slice(0, 160),
                })
                .eq("id", convo.id);
            } else {
              await supabase
                .from("conversations")
                .update({ metadata: nextMeta, tags, preview: reply.slice(0, 160) })
                .eq("id", convo.id);
            }
            await supabase.from("messages").insert({
              org_id: ORG_ID,
              conversation_id: convo.id,
              sender: "ai",
              body: reply,
              metadata: { service_ticket: ticket },
            });
            try {
              await sendWhatsAppText(from, reply, cfg);
            } catch (err) {
              console.error("WA service ticket send failed", err);
            }
            if (ticket.status === "ready" || (nextMeta.service_ticket as ServiceTicket)?.status === "handed_off") {
              try {
                const { fireAutomations } = await import("@/server/automation-engine");
                fireAutomations("conversation_escalated", { conversationId: convo.id as string });
              } catch (err) {
                console.error("service escalate automation", err);
              }
            }
            continue;
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

          // Photo ask: short line + up to 3 real images (more = next batch same collection)
          // Do not steal product Q&A turns — product intent already handled above.
          if (
            !educateOnly &&
            referenceImages.length > 0 &&
            (wantsReferenceImages(text) || (askingMore && lastCollection)) &&
            !isProductIntent(text)
          ) {
            const photos = referenceImages.slice(0, 3);
            reply = askingMore
              ? referencePhotosReplyForLang(sessionLang, true)
              : referencePhotosReplyForLang(sessionLang, false);
            const newIds = [...sentPhotoIds, ...photos.map((p) => p.documentId)];
            const collection = photos[0]?.collection || lastCollection;
            inspector = buildAnswerInspector({
              chunks: [],
              replySource: "openai",
              model: "gpt-4o-mini",
              agentName: "EnerBot",
              channel: "whatsapp",
              visitorName: (convo.visitor_name as string) || contactName || "WhatsApp customer",
              downloadCount: 0,
              memoryEnabled: true,
            });
            (inspector.metadata as Record<string, unknown>).reference_images = photos.map((r) => ({
              url: r.imageUrl,
              title: r.title,
              collection: r.collection,
              file_name: r.fileName,
              mime_type: r.mimeType,
              document_id: r.documentId,
            }));

            await supabase
              .from("conversations")
              .update({
                metadata: {
                  ...prevMeta,
                  sent_reference_ids: newIds.slice(-30),
                  last_reference_collection: collection,
                },
              })
              .eq("id", convo.id);

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

            for (const img of photos) {
              try {
                await sendWhatsAppImage({
                  toPhone: from,
                  imageUrl: img.imageUrl,
                  cfg,
                });
              } catch (err) {
                console.error("WhatsApp reference image send failed", err);
              }
            }
            continue;
          }

          // Photos/assets asked but not in Knowledge Base yet — soft wait, flag for team
          if (wantsReferenceImages(text) && referenceImages.length === 0) {
            reply = kbPendingSendReplyForLang(sessionLang);
            const tags = Array.isArray((convo as { tags?: string[] }).tags)
              ? [...((convo as { tags?: string[] }).tags || [])]
              : [];
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
              })
              .eq("id", convo.id);
            await supabase.from("messages").insert({
              org_id: ORG_ID,
              conversation_id: convo.id,
              sender: "ai",
              body: reply,
              metadata: { pending_kb: true, human_like_wait: true },
            });
            try {
              await supabase.from("notifications").insert({
                org_id: ORG_ID,
                title: "Customer asked for photos / assets",
                body: text.slice(0, 160),
                href: `/inbox?c=${convo.id}`,
                conversation_id: convo.id,
                metadata: { pending_kb: true },
              });
            } catch (err) {
              console.error("pending KB notify failed", err);
            }
            try {
              await sendWhatsAppText(from, reply, cfg);
            } catch (err) {
              console.error("WA pending KB send failed", err);
            }
            continue;
          }

          if (askingMore && lastCollection && referenceImages.length === 0) {
            reply =
              sessionLang === "hi" || sessionLang === "mixed"
                ? "Sir, abhi ke liye saari available reference photos share kar di. Catalogue ya service chahiye to bataiye."
                : sessionLang === "mr"
                  ? "Sir, atapare available reference photos share kele. Catalogue kinva service pahije asel tar sanga."
                  : "Sir, I have shared all available reference photos for now. Please tell me if you need a catalogue or service help.";
            await supabase.from("messages").insert({
              org_id: ORG_ID,
              conversation_id: convo.id,
              sender: "ai",
              body: reply,
            });
            try {
              await sendWhatsAppText(from, reply, cfg);
            } catch (err) {
              console.error("WA more-photos empty send failed", err);
            }
            continue;
          }

          if (isBusinessAutoReplyMessage(text)) {
            continue;
          }

          if (isOffTopicMessage(text, { conversationActive: true })) {
            reply = offTopicReplyForLang(sessionLang);
            inspector = buildAnswerInspector({
              chunks: [],
              replySource: "fallback",
              model: "gpt-4o-mini",
              agentName: "EnerBot",
              channel: "whatsapp",
              visitorName: (convo.visitor_name as string) || contactName || "WhatsApp customer",
              downloadCount: 0,
              memoryEnabled: true,
            });
            (inspector.metadata as Record<string, unknown>).off_topic = true;
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
            continue;
          }

          const knowledgeContext = formatKnowledgeContext(chunks);
          const productsContext = await buildProductsContextForAi(text);
          const stack = await resolveAgentStack({
            channel: "whatsapp",
            message: text,
          });
          const agentCfg = agentReplyConfig(stack);
          const { sanitizeAssistantFileLinks } = await import("@/server/shorten-urls");
          // Definition asks: use KB text only — do not attach PDF download prompts
          const downloadLinks = educateOnly ? [] : downloadLinksFromChunks(chunks);
          const generated = await generateOpenAiReply({
            visitorName: (convo.visitor_name as string) || contactName || "WhatsApp customer",
            latestUserMessage: text,
            history: (history || []).map((m) => ({
              sender: m.sender as string,
              body: m.body as string,
              created_at: m.created_at as string,
            })),
            knowledgeContext,
            productsContext,
            downloadLinks,
            referenceImages: [],
            systemPrompt: educateOnly
              ? [
                  agentCfg.systemPrompt,
                  "Customer asked what something is / meaning / difference. Explain clearly in plain language from Knowledge Base. Do not send catalogue PDFs or product dumps. End with one soft next step only if helpful (kW, price, or catalogue).",
                ].join("\n")
              : agentCfg.systemPrompt,
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
            channel: "whatsapp",
            visitorName: (convo.visitor_name as string) || contactName || "WhatsApp customer",
            downloadCount: downloadLinks.length,
            memoryEnabled: agentCfg.memoryEnabled,
            productsUseful: isProductIntent(text) && Boolean(productsContext?.trim()),
          });
          if (agentCfg.agentId) {
            await supabase
              .from("conversations")
              .update({
                agent_id: agentCfg.agentId,
                assignee_label: agentCfg.assigneeLabel,
                metadata: {
                  ...prevMeta,
                  preferred_lang: sessionLang,
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
          continue;
        } catch (err) {
          console.error("WhatsApp AI reply failed", err);
          if (isProductIntent(text)) {
            reply =
              sessionLang === "hi" || sessionLang === "mixed"
                ? "Sir, aapka product request mil gaya. Main Products / Knowledge Base se details nikal raha hoon — thoda wait karein, ya model / kW / residential-commercial confirm karein."
                : "Got your product request. I’m pulling details from our Products and Knowledge Base — please wait a moment, or share model / kW / residential-commercial.";
          }
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
      accessToken: z.string().min(10).max(2000),
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
    `${GRAPH_BASE}/${cfg.phone_number_id}?fields=display_phone_number,verified_name,quality_rating,whatsapp_business_account{id,name}`,
    {
      headers: { Authorization: `Bearer ${cfg.access_token}` },
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    whatsapp_business_account?: { id?: string; name?: string } | string;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(json.error?.message || `Meta Graph error (${res.status})`);
  }

  const wabaFromPhone = (() => {
    const waba = json.whatsapp_business_account;
    if (typeof waba === "string" && waba.trim()) return waba.trim();
    if (waba && typeof waba === "object" && waba.id) return String(waba.id).trim();
    return null;
  })();

  let templateCount: number | null = null;
  let wabaCorrected = false;
  const configuredWaba = (cfg.business_account_id || "").trim();
  const wabaToUse =
    wabaFromPhone && configuredWaba && configuredWaba !== wabaFromPhone ? wabaFromPhone : configuredWaba || wabaFromPhone;

  if (wabaToUse) {
    const tplRes = await fetch(
      `${GRAPH_BASE}/${encodeURIComponent(wabaToUse)}/message_templates?limit=1&summary=total_count`,
      { headers: { Authorization: `Bearer ${cfg.access_token}` } },
    );
    const tplJson = (await tplRes.json().catch(() => ({}))) as {
      summary?: { total_count?: number };
      data?: unknown[];
    };
    if (tplRes.ok) {
      templateCount =
        typeof tplJson.summary?.total_count === "number"
          ? tplJson.summary.total_count
          : Array.isArray(tplJson.data)
            ? tplJson.data.length
            : 0;
    }
  }

  const shouldFixWaba =
    wabaFromPhone &&
    (!configuredWaba ||
      configuredWaba === cfg.phone_number_id ||
      (templateCount === 0 && configuredWaba !== wabaFromPhone));

  if (shouldFixWaba && wabaFromPhone) {
    const supabase = createServiceSupabase();
    await supabase
      .from("channels")
      .update({
        config: { ...cfg, business_account_id: wabaFromPhone },
      })
      .eq("org_id", ORG_ID)
      .eq("type", "whatsapp");
    wabaCorrected = true;
    cfg.business_account_id = wabaFromPhone;
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
    templateCount,
    wabaCorrected,
    wabaId: cfg.business_account_id ? `${cfg.business_account_id.slice(0, 4)}…` : null,
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
      attachment: z
        .object({
          url: z.string().url(),
          fileName: z.string().min(1).max(200),
          mimeType: z.string().max(120).optional(),
          caption: z.string().max(1024).optional(),
        })
        .optional(),
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

    let waMessageId: string | null = null;
    if (data.attachment?.url) {
      const fileName = data.attachment.fileName;
      const mime = (data.attachment.mimeType || "").toLowerCase();
      const isImage =
        mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(fileName);
      if (isImage) {
        const json = await sendWhatsAppImage({
          toPhone: phone,
          imageUrl: data.attachment.url,
          caption: data.attachment.caption || undefined,
        });
        waMessageId = extractWhatsAppOutboundId(json as Record<string, unknown>);
      } else {
        const json = await sendWhatsAppDocument({
          toPhone: phone,
          documentUrl: data.attachment.url,
          fileName,
          caption: data.attachment.caption || undefined,
        });
        waMessageId = extractWhatsAppOutboundId(json as Record<string, unknown>);
      }
    } else {
      const json = await sendWhatsAppText(phone, data.body);
      waMessageId = extractWhatsAppOutboundId(json as Record<string, unknown>);
    }
    return { ok: true, window: win, via: marketplace ? channel : "whatsapp", waMessageId };
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

    const { formatProductRecommendationCaption, resolveProductImageUrl } = await import("@/lib/product-card");
    const caption = formatProductRecommendationCaption(product as import("@/lib/db-types").DbProduct);

    let imageUrl = resolveProductImageUrl(product as import("@/lib/db-types").DbProduct);

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
