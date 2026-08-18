import { getBrowserSupabase } from "@/lib/supabase";
import type { DbConversation, DbMessage, ChannelType, DbCustomer, DbLead, PriorityLevel } from "@/lib/db-types";
import { buildPlaceholderAiReply } from "@/lib/chat-replies";
import { normalizeWhatsAppDigits } from "@/lib/whatsapp-window";
import {
  conversationMeta,
  INBOX_INTERNAL_NOTE_KEY,
  INBOX_SNOOZE_UNTIL_KEY,
  normalizeConversationTags,
  stripInboxSnooze,
} from "@/lib/inbox-snooze";

export { buildPlaceholderAiReply };
export const ENERTECH_ORG_ID = "a0000000-0000-4000-8000-000000000001";
export const WIDGET_SESSION_KEY = "enertech-widget-session";

export function getOrCreateWidgetSessionId(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  let id = localStorage.getItem(WIDGET_SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(WIDGET_SESSION_KEY, id);
  }
  return id;
}

export type InboxConversation = DbConversation & {
  customer?: Pick<DbCustomer, "id" | "name" | "company" | "email" | "phone"> | null;
  lead?: Pick<DbLead, "id" | "name" | "company" | "status" | "score" | "priority" | "product_label"> | null;
};

export type ListConversationsOptions = {
  /** DB channel value, e.g. website | whatsapp | indiamart */
  channel?: string | null;
  /** unread_count > 0 */
  unreadOnly?: boolean;
  /** Has assignee_id or assignee_label */
  assignedOnly?: boolean;
  limit?: number;
};

const CONVERSATION_SELECT =
  "*, customer:customers(id, name, company, email, phone), lead:leads(id, name, company, status, score, priority, product_label)";

export async function listConversations(
  orgId: string = ENERTECH_ORG_ID,
  options: ListConversationsOptions = {},
): Promise<InboxConversation[]> {
  const supabase = getBrowserSupabase();
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);

  let query = supabase
    .from("conversations")
    .select(CONVERSATION_SELECT)
    .eq("org_id", orgId);

  if (options.channel) {
    query = query.eq("channel", options.channel);
  }
  if (options.unreadOnly) {
    query = query.gt("unread_count", 0);
  }
  if (options.assignedOnly) {
    // Human-assigned only — assignee_label alone matches AI labels like "AI · Support Agent"
    query = query.not("assignee_id", "is", null);
  }

  // WhatsApp-style: latest message activity first (customer reply bumps thread to top).
  // Do not primary-sort by updated_at — mark-as-read also bumps updated_at.
  const { data, error } = await query
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = (data ?? []) as InboxConversation[];
  // Website: only show chats after chatbot contact form (real name + phone) — hide anonymous opens
  const visible = rows.filter((c) => {
    if (c.channel !== "website") return true;
    const phone = (c.visitor_phone || c.customer?.phone || "").replace(/\D/g, "");
    const name = (c.customer?.name || c.visitor_name || "").trim();
    const anon =
      !name ||
      name.toLowerCase() === "website visitor" ||
      name.toLowerCase() === "visitor";
    return phone.length >= 10 && !anon;
  });

  // Stable client sort after website filter (null last_message_at → created_at)
  return visible.sort((a, b) => {
    const ta = new Date(a.last_message_at || a.created_at || 0).getTime();
    const tb = new Date(b.last_message_at || b.created_at || 0).getTime();
    return tb - ta;
  });
}

/** Single conversation for deep links when the row is outside the current list/filter. */
export async function getConversationById(
  conversationId: string,
  orgId: string = ENERTECH_ORG_ID,
): Promise<InboxConversation | null> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_SELECT)
    .eq("org_id", orgId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw error;
  return (data as InboxConversation | null) ?? null;
}

export async function listMessages(conversationId: string): Promise<DbMessage[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.from("messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DbMessage[];
}

async function getWebsiteChannelId(orgId: string): Promise<string | null> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.from("channels").select("id").eq("org_id", orgId).eq("type", "website").maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function getOrCreateWidgetConversation(options?: { orgId?: string; visitorName?: string }): Promise<DbConversation> {
  const orgId = options?.orgId ?? ENERTECH_ORG_ID;
  const sessionId = getOrCreateWidgetSessionId();
  const supabase = getBrowserSupabase();

  const { data: existing, error: findError } = await supabase.from("conversations").select("*").eq("org_id", orgId).eq("widget_session_id", sessionId).eq("channel", "website").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (findError) throw findError;
  if (existing) return existing as DbConversation;

  const channelId = await getWebsiteChannelId(orgId);
  const externalRef = `CV-${Date.now().toString().slice(-6)}`;

  const { data: created, error: createError } = await supabase
    .from("conversations")
    .insert({ org_id: orgId, channel_id: channelId, channel: "website" as ChannelType, external_ref: externalRef, status: "ai", assignee_label: "AI · Support Agent", visitor_name: options?.visitorName ?? "Website visitor", widget_session_id: sessionId, tags: ["Website"], unread_count: 0 })
    .select("*")
    .single();

  if (createError) throw createError;
  return created as DbConversation;
}

export async function sendCustomerMessage(conversationId: string, body: string, orgId = ENERTECH_ORG_ID) {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.from("messages").insert({ org_id: orgId, conversation_id: conversationId, sender: "customer", body }).select("*").single();
  if (error) throw error;
  return data as DbMessage;
}

export async function sendAiMessage(conversationId: string, body: string, orgId = ENERTECH_ORG_ID) {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.from("messages").insert({ org_id: orgId, conversation_id: conversationId, sender: "ai", body, confidence: 0.7, sources: [] }).select("*").single();
  if (error) throw error;
  return data as DbMessage;
}

export async function sendAgentMessage(
  conversationId: string,
  body: string,
  profileId: string,
  orgId = ENERTECH_ORG_ID,
  assigneeLabel?: string,
  metadata?: Record<string, unknown>,
) {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      org_id: orgId,
      conversation_id: conversationId,
      sender: "agent",
      sender_profile_id: profileId,
      body,
      ...(metadata ? { metadata } : {}),
    })
    .select("*")
    .single();
  if (error) throw error;

  const label = assigneeLabel?.trim() || "Human agent";
  const { data: convoRow } = await supabase
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .maybeSingle();
  const nextMeta = stripInboxSnooze(conversationMeta(convoRow?.metadata));
  await supabase
    .from("conversations")
    .update({
      status: "human",
      assignee_id: profileId,
      assignee_label: label,
      unread_count: 0,
      last_message_at: new Date().toISOString(),
      preview: body.slice(0, 160),
      metadata: nextMeta,
    })
    .eq("id", conversationId);

  return data as DbMessage;
}

async function patchConversationMetadata(
  conversationId: string,
  mutate: (meta: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const supabase = getBrowserSupabase();
  const { data: row, error: readError } = await supabase
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .maybeSingle();
  if (readError) throw readError;
  const next = mutate(conversationMeta(row?.metadata));
  const { error } = await supabase
    .from("conversations")
    .update({ metadata: next })
    .eq("id", conversationId);
  if (error) throw error;
}

/** Desk reminder on the thread. Does not touch leads / Brainmine. */
export async function setInboxSnooze(conversationId: string, untilIso: string): Promise<void> {
  const t = Date.parse(untilIso);
  if (!Number.isFinite(t)) throw new Error("Pick a valid date and time");
  await patchConversationMetadata(conversationId, (meta) => ({
    ...meta,
    [INBOX_SNOOZE_UNTIL_KEY]: new Date(t).toISOString(),
  }));
}

export async function clearInboxSnooze(conversationId: string): Promise<void> {
  await patchConversationMetadata(conversationId, (meta) => stripInboxSnooze(meta));
}

export async function patchMessageMetadata(
  messageId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const supabase = getBrowserSupabase();
  const { data: row, error: readError } = await supabase
    .from("messages")
    .select("metadata")
    .eq("id", messageId)
    .maybeSingle();
  if (readError) throw readError;
  const prev = ((row?.metadata || {}) as Record<string, unknown>) || {};
  const { error } = await supabase
    .from("messages")
    .update({ metadata: { ...prev, ...patch } })
    .eq("id", messageId);
  if (error) throw error;
}

const ATTACH_BUCKET = "knowledge";

/** Agent uploads image/PDF into a conversation (Inbox paperclip). */
export async function uploadAgentAttachment(options: {
  conversationId: string;
  orgId: string;
  profileId: string;
  assigneeLabel?: string;
  file: File;
}): Promise<DbMessage> {
  const { conversationId, orgId, profileId, assigneeLabel, file } = options;
  const lower = file.name.toLowerCase();
  const mime = (file.type || "").toLowerCase();
  const allowed =
    mime.startsWith("image/") ||
    mime === "application/pdf" ||
    /\.(png|jpe?g|webp|gif|pdf)$/i.test(lower);
  if (!allowed) throw new Error("Only images (PNG/JPG/WEBP/GIF) or PDF files are supported.");
  if (file.size > 8 * 1024 * 1024) throw new Error("File too large (max 8 MB).");

  try {
    const { ensureKnowledgeStorage } = await import("@/server/knowledge");
    await ensureKnowledgeStorage();
  } catch (err) {
    console.warn("ensureKnowledgeStorage", err);
  }

  const supabase = getBrowserSupabase();
  const safeName = file.name.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 120);
  const storagePath = `chat/${orgId}/${conversationId}/agent-${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage.from(ATTACH_BUCKET).upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploadError) {
    throw new Error(
      `Upload failed: ${uploadError.message}. Ensure the knowledge storage bucket exists.`,
    );
  }

  const { data: pub } = supabase.storage.from(ATTACH_BUCKET).getPublicUrl(storagePath);
  const url = pub.publicUrl;
  const isImage = mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(lower);
  const body = isImage ? `Shared an image: ${safeName}` : `Shared a file: ${safeName}`;

  return sendAgentMessage(conversationId, body, profileId, orgId, assigneeLabel, {
    attachment: true,
    file_name: safeName,
    mime_type: file.type || null,
    storage_path: storagePath,
    url,
  });
}

export async function markConversationRead(conversationId: string) {
  const supabase = getBrowserSupabase();
  const { error } = await supabase.from("conversations").update({ unread_count: 0 }).eq("id", conversationId);
  if (error) throw error;
}

export type HandoffState = "Waiting" | "Assigned" | "Needs reply" | "Resolved";

export type HandoffSla = "ok" | "warn" | "critical";

export type HandoffItem = InboxConversation & {
  handoffState: HandoffState;
  waitingLabel: string;
  waitingMinutes: number;
  escalatedAt: string | null;
  reason: string;
  priority: PriorityLevel;
  sla: HandoffSla;
};

function handoffMeta(c: InboxConversation): Record<string, unknown> {
  return ((c.metadata || {}) as Record<string, unknown>) || {};
}

function escalatedAtIso(c: InboxConversation): string | null {
  const meta = handoffMeta(c);
  if (typeof meta.escalated_at === "string" && meta.escalated_at) return meta.escalated_at;
  if (c.status === "escalated" || c.status === "human") {
    return c.updated_at || c.last_message_at || c.created_at || null;
  }
  return null;
}

function minutesSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 60_000));
}

function deriveHandoffState(c: InboxConversation): HandoffState {
  if (c.status === "resolved" || c.status === "closed") return "Resolved";
  if (c.status === "escalated" && !c.assignee_id) return "Waiting";
  if ((c.status === "human" || c.status === "escalated") && c.assignee_id) {
    return c.unread_count > 0 ? "Needs reply" : "Assigned";
  }
  if (c.status === "human") return "Waiting";
  return "Waiting";
}

function deriveReason(c: InboxConversation): string {
  const meta = handoffMeta(c);
  if (typeof meta.handoff_reason === "string" && meta.handoff_reason.trim()) {
    return meta.handoff_reason.trim();
  }
  if (c.status === "escalated") return "Customer requested human";
  if (c.confidence != null && Number(c.confidence) < 0.5) {
    return `Low AI confidence (${Number(c.confidence).toFixed(2)})`;
  }
  if (c.assignee_id) return "Claimed by agent";
  return "Support handoff";
}

function derivePriority(c: InboxConversation): PriorityLevel {
  const leadPriority = c.lead?.priority;
  if (leadPriority === "High" || leadPriority === "Medium" || leadPriority === "Low") return leadPriority;
  if (c.status === "escalated") return "High";
  return "Medium";
}

function deriveSla(waitingMinutes: number, state: HandoffState): HandoffSla {
  if (state === "Resolved") return "ok";
  if (waitingMinutes >= 60) return "critical";
  if (waitingMinutes >= 15) return "warn";
  return "ok";
}

/** Escalated / true human handoffs + conversations resolved today. */
export async function listHandoffQueue(orgId: string = ENERTECH_ORG_ID): Promise<HandoffItem[]> {
  const { isTrueHandoffConversation } = await import("@/lib/conversation-guards");
  const supabase = getBrowserSupabase();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_SELECT)
    .eq("org_id", orgId)
    .in("status", ["escalated", "human", "resolved"])
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const rows = (data ?? []) as InboxConversation[];
  return rows
    .filter((c) => {
      if (c.status === "escalated") return true;
      if (c.status === "human") return isTrueHandoffConversation(c);
      if (c.status === "resolved") {
        const ts = c.updated_at || c.last_message_at || c.created_at;
        return Boolean(ts && new Date(ts) >= todayStart);
      }
      return false;
    })
    .map((c) => {
      const escalatedAt = escalatedAtIso(c);
      const waitMins = minutesSince(escalatedAt);
      const handoffState = deriveHandoffState(c);
      return {
        ...c,
        handoffState,
        escalatedAt,
        waitingMinutes: waitMins,
        waitingLabel: formatRelativeTime(escalatedAt),
        reason: deriveReason(c),
        priority: derivePriority(c),
        sla: deriveSla(waitMins, handoffState),
      };
    });
}

/** Live sidebar badge: unassigned waiting escalations / handoffs. */
export async function countWaitingHandoffs(orgId: string = ENERTECH_ORG_ID): Promise<number> {
  const items = await listHandoffQueue(orgId);
  return items.filter((i) => i.handoffState === "Waiting").length;
}

export async function claimConversation(options: {
  conversationId: string;
  profileId: string;
  assigneeLabel: string;
}): Promise<void> {
  const supabase = getBrowserSupabase();
  const { data: row } = await supabase
    .from("conversations")
    .select("metadata")
    .eq("id", options.conversationId)
    .maybeSingle();
  const meta = ((row?.metadata || {}) as Record<string, unknown>) || {};
  const { error } = await supabase
    .from("conversations")
    .update({
      status: "human",
      assignee_id: options.profileId,
      assignee_label: options.assigneeLabel,
      metadata: {
        ...meta,
        handoff: true,
        claimed_at: new Date().toISOString(),
        handoff_reason:
          (typeof meta.handoff_reason === "string" && meta.handoff_reason) || "Claimed from Human Support",
        escalated_at:
          (typeof meta.escalated_at === "string" && meta.escalated_at) || new Date().toISOString(),
      },
    })
    .eq("id", options.conversationId);
  if (error) throw error;
}

export async function transferConversation(options: {
  conversationId: string;
  profileId: string;
  assigneeLabel: string;
}): Promise<void> {
  const supabase = getBrowserSupabase();
  const { data: row } = await supabase
    .from("conversations")
    .select("metadata")
    .eq("id", options.conversationId)
    .maybeSingle();
  const meta = ((row?.metadata || {}) as Record<string, unknown>) || {};
  const { error } = await supabase
    .from("conversations")
    .update({
      status: "human",
      assignee_id: options.profileId,
      assignee_label: options.assigneeLabel,
      metadata: {
        ...meta,
        handoff: true,
        transferred_at: new Date().toISOString(),
        handoff_reason:
          (typeof meta.handoff_reason === "string" && meta.handoff_reason) || "Transferred in Human Support",
      },
    })
    .eq("id", options.conversationId);
  if (error) throw error;
}

export async function updateConversationTags(conversationId: string, tags: string[]): Promise<string[]> {
  const next = normalizeConversationTags(tags);
  const supabase = getBrowserSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({ tags: next })
    .eq("id", conversationId);
  if (error) throw error;
  return next;
}

export async function updateConversationInternalNote(
  conversationId: string,
  note: string,
): Promise<void> {
  const trimmed = note.trim().slice(0, 4000);
  await patchConversationMetadata(conversationId, (meta) => {
    const next = { ...meta };
    if (trimmed) next[INBOX_INTERNAL_NOTE_KEY] = trimmed;
    else delete next[INBOX_INTERNAL_NOTE_KEY];
    return next;
  });
}

export async function resolveConversation(conversationId: string): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({
      status: "resolved",
      unread_count: 0,
    })
    .eq("id", conversationId);
  if (error) throw error;
}

export async function returnConversationToAi(
  conversationId: string,
): Promise<{ resumed: boolean }> {
  const { returnConversationToAiServer } = await import("@/server/conversation-handoff");
  const result = await returnConversationToAiServer({ data: { conversationId } });
  return { resumed: Boolean(result.resumed) };
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function pickLeadWhatsAppThread(
  rows: Array<{
    id: string;
    channel: string | null;
    last_message_at?: string | null;
    updated_at?: string | null;
  }>,
): string | null {
  if (!rows.length) return null;
  const ranked = [...rows].sort((a, b) => {
    const score = (c: (typeof rows)[0]) =>
      (c.channel === "whatsapp" ? 2 : 0) +
      (c.channel === "indiamart" || c.channel === "tradeindia" ? 1 : 0);
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return String(b.last_message_at || b.updated_at || "").localeCompare(
      String(a.last_message_at || a.updated_at || ""),
    );
  });
  return ranked[0]?.id || null;
}

/** Leads → Inbox WhatsApp: reuse linked/phone thread or create one. */
export async function findOrOpenLeadWhatsAppConversation(options: {
  orgId: string;
  leadId: string;
  phone?: string | null;
  name?: string | null;
}): Promise<{ conversationId: string; created: boolean }> {
  const supabase = getBrowserSupabase();
  const digits = normalizeWhatsAppDigits(options.phone);
  if (!digits) throw new Error("This lead has no WhatsApp phone number");

  const { data: byLead, error: leadErr } = await supabase
    .from("conversations")
    .select("id, channel, last_message_at, updated_at")
    .eq("org_id", options.orgId)
    .eq("lead_id", options.leadId)
    .order("last_message_at", { ascending: false })
    .limit(12);
  if (leadErr) throw leadErr;
  const fromLead = pickLeadWhatsAppThread(
    (byLead || []).filter((c) =>
      c.channel === "whatsapp" || c.channel === "indiamart" || c.channel === "tradeindia" || c.channel === "website",
    ),
  );
  if (fromLead) return { conversationId: fromLead, created: false };

  const last10 = digits.slice(-10);
  const { data: byPhone, error: phoneErr } = await supabase
    .from("conversations")
    .select("id, channel, lead_id, last_message_at, updated_at")
    .eq("org_id", options.orgId)
    .in("channel", ["whatsapp", "indiamart", "tradeindia"])
    .or(`visitor_phone.eq.${digits},visitor_phone.eq.${last10},visitor_phone.like.%${last10}`)
    .order("last_message_at", { ascending: false })
    .limit(12);
  if (phoneErr) throw phoneErr;
  const phoneHit = pickLeadWhatsAppThread(byPhone || []);
  if (phoneHit) {
    const row = (byPhone || []).find((c) => c.id === phoneHit);
    if (row && !row.lead_id) {
      await supabase.from("conversations").update({ lead_id: options.leadId }).eq("id", phoneHit);
    }
    return { conversationId: phoneHit, created: false };
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("id")
    .eq("org_id", options.orgId)
    .eq("type", "whatsapp")
    .maybeSingle();

  const now = new Date().toISOString();
  const { data: created, error: createErr } = await supabase
    .from("conversations")
    .insert({
      org_id: options.orgId,
      channel_id: channel?.id || null,
      channel: "whatsapp" as ChannelType,
      lead_id: options.leadId,
      external_ref: `WA-${last10.slice(-6)}`,
      status: "human",
      assignee_label: "Sales",
      visitor_name: options.name?.trim() || `WhatsApp ${last10.slice(-4)}`,
      visitor_phone: digits,
      widget_session_id: `wa:${digits}`,
      tags: ["WhatsApp", "Lead"],
      unread_count: 0,
      last_message_at: now,
      preview: options.name ? `${options.name} · ${digits}` : digits,
      metadata: { wa_id: digits, opened_from: "leads" },
    })
    .select("id")
    .single();
  if (createErr) throw createErr;
  return { conversationId: created.id as string, created: true };
}
