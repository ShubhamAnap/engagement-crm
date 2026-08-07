import { getBrowserSupabase } from "@/lib/supabase";
import type { DbConversation, DbMessage, ChannelType, DbCustomer, DbLead, PriorityLevel } from "@/lib/db-types";
import { buildPlaceholderAiReply } from "@/lib/chat-replies";

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
  lead?: Pick<DbLead, "id" | "name" | "status" | "score" | "priority" | "product_label"> | null;
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

export async function listConversations(
  orgId: string = ENERTECH_ORG_ID,
  options: ListConversationsOptions = {},
): Promise<InboxConversation[]> {
  const supabase = getBrowserSupabase();
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);

  let query = supabase
    .from("conversations")
    .select(
      "*, customer:customers(id, name, company, email, phone), lead:leads(id, name, status, score, priority, product_label)",
    )
    .eq("org_id", orgId);

  if (options.channel) {
    query = query.eq("channel", options.channel);
  }
  if (options.unreadOnly) {
    query = query.gt("unread_count", 0);
  }
  if (options.assignedOnly) {
    query = query.or("assignee_id.not.is.null,assignee_label.not.is.null");
  }

  // Prefer activity time: messages update last_message_at; form/create update updated_at
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;

  const rows = (data ?? []) as InboxConversation[];
  // Website: only show chats after chatbot contact form (real name + phone) — hide anonymous opens
  return rows.filter((c) => {
    if (c.channel !== "website") return true;
    const phone = (c.visitor_phone || c.customer?.phone || "").replace(/\D/g, "");
    const name = (c.customer?.name || c.visitor_name || "").trim();
    const anon =
      !name ||
      name.toLowerCase() === "website visitor" ||
      name.toLowerCase() === "visitor";
    return phone.length >= 10 && !anon;
  });
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
  await supabase
    .from("conversations")
    .update({
      status: "human",
      assignee_id: profileId,
      assignee_label: label,
      unread_count: 0,
      last_message_at: new Date().toISOString(),
      preview: body.slice(0, 160),
    })
    .eq("id", conversationId);

  return data as DbMessage;
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
  const body = isImage
    ? `Shared an image: ${safeName}\n${url}`
    : `Shared a file: ${safeName}\n${url}`;

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

export type HandoffState = "Waiting" | "Assigned" | "Working" | "Resolved";

export type HandoffItem = InboxConversation & {
  handoffState: HandoffState;
  waitingLabel: string;
  reason: string;
  priority: PriorityLevel;
};

function deriveHandoffState(c: InboxConversation): HandoffState {
  if (c.status === "resolved" || c.status === "closed") return "Resolved";
  if (c.status === "escalated" && !c.assignee_id) return "Waiting";
  if (c.status === "human" && c.assignee_id) {
    return c.unread_count > 0 ? "Working" : "Assigned";
  }
  if (c.status === "human") return "Waiting";
  if (c.status === "escalated") return "Assigned";
  return "Waiting";
}

function deriveReason(c: InboxConversation): string {
  const meta = (c.metadata || {}) as Record<string, unknown>;
  if (typeof meta.handoff_reason === "string" && meta.handoff_reason.trim()) {
    return meta.handoff_reason;
  }
  if (c.status === "escalated") return "Customer requested human";
  if (c.confidence != null && Number(c.confidence) < 0.5) {
    return `Low AI confidence (${Number(c.confidence).toFixed(2)})`;
  }
  if (c.status === "human") return "Human takeover";
  return "Support handoff";
}

function derivePriority(c: InboxConversation): PriorityLevel {
  const leadPriority = c.lead?.priority;
  if (leadPriority === "High" || leadPriority === "Medium" || leadPriority === "Low") return leadPriority;
  if (c.status === "escalated") return "High";
  return "Medium";
}

/** Escalated / human queue + conversations resolved today. */
export async function listHandoffQueue(orgId: string = ENERTECH_ORG_ID): Promise<HandoffItem[]> {
  const supabase = getBrowserSupabase();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("conversations")
    .select(
      "*, customer:customers(id, name, company, email, phone), lead:leads(id, name, status, score, priority, product_label)",
    )
    .eq("org_id", orgId)
    .in("status", ["escalated", "human", "resolved"])
    .order("updated_at", { ascending: false })
    .limit(150);
  if (error) throw error;

  const rows = (data ?? []) as InboxConversation[];
  return rows
    .filter((c) => {
      if (c.status === "escalated" || c.status === "human") return true;
      if (c.status === "resolved") {
        const ts = c.updated_at || c.last_message_at || c.created_at;
        return Boolean(ts && new Date(ts) >= todayStart);
      }
      return false;
    })
    .map((c) => ({
      ...c,
      handoffState: deriveHandoffState(c),
      waitingLabel: formatRelativeTime(c.updated_at || c.last_message_at || c.created_at),
      reason: deriveReason(c),
      priority: derivePriority(c),
    }));
}

export async function claimConversation(options: {
  conversationId: string;
  profileId: string;
  assigneeLabel: string;
}): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({
      status: "human",
      assignee_id: options.profileId,
      assignee_label: options.assigneeLabel,
    })
    .eq("id", options.conversationId);
  if (error) throw error;
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

export async function returnConversationToAi(conversationId: string): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({
      status: "ai",
      assignee_id: null,
      assignee_label: "AI · Support Agent",
    })
    .eq("id", conversationId);
  if (error) throw error;
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
