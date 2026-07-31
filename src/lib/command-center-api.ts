import { getBrowserSupabase } from "@/lib/supabase";
import type { ChannelType, ConversationStatus, DbMessage } from "@/lib/db-types";
import { formatRelativeTime } from "@/lib/chat-api";

export type LiveSession = {
  id: string;
  externalRef: string;
  customer: string;
  company: string;
  channel: ChannelType;
  status: ConversationStatus;
  agentLabel: string;
  confidence: number;
  sources: number;
  tokensEstimate: number;
  latencyMs: number;
  memory: "Warm" | "Cold";
  escalation: "None" | "Watch" | "Triggered";
  preview: string;
  lastActivity: string;
  lastActivityLabel: string;
  messageCount: number;
  tags: string[];
};

export type SessionTimelineEvent = {
  id: string;
  t: string;
  label: string;
  detail: string;
  tone: "neutral" | "info" | "primary" | "success" | "warning" | "danger";
};

export type CommandCenterSnapshot = {
  sessions: LiveSession[];
  kpis: {
    live: number;
    avgConfidence: number;
    avgLatencyMs: number;
    escalations: number;
    channels: number;
  };
};

const CHANNEL_LABELS: Record<string, string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  email: "Email",
  instagram: "Instagram",
  facebook: "Facebook",
  indiamart: "IndiaMART",
  tradeindia: "TradeIndia",
  brainmine: "Brainmine CRM+",
  api: "API",
  webhook: "Webhook",
};

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function latencyFromGap(prevIso: string | null, currIso: string): number {
  if (!prevIso) return 800;
  const ms = new Date(currIso).getTime() - new Date(prevIso).getTime();
  if (ms < 100 || ms > 120_000) return 900;
  return ms;
}

function memoryFromMessages(count: number): "Warm" | "Cold" {
  return count >= 4 ? "Warm" : "Cold";
}

function escalationFromStatus(status: ConversationStatus, confidence: number): LiveSession["escalation"] {
  if (status === "escalated") return "Triggered";
  if (status === "human") return "Watch";
  if (confidence > 0 && confidence < 0.55) return "Watch";
  return "None";
}

function sourceCount(sources: unknown): number {
  if (Array.isArray(sources)) return sources.length;
  return 0;
}

export async function getCommandCenterSnapshot(orgId: string): Promise<CommandCenterSnapshot> {
  const supabase = getBrowserSupabase();

  const { data: convos, error } = await supabase
    .from("conversations")
    .select(
      "id, external_ref, channel, status, subject, preview, confidence, assignee_label, visitor_name, visitor_company, tags, metadata, last_message_at, updated_at, created_at, customer:customers(name, company)",
    )
    .eq("org_id", orgId)
    .in("status", ["ai", "human", "escalated"])
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(60);

  if (error) throw error;

  const rows = convos ?? [];
  const ids = rows.map((r) => r.id as string);

  let messages: Array<{
    id: string;
    conversation_id: string;
    sender: string;
    body: string;
    confidence: number | null;
    sources: unknown;
    created_at: string;
  }> = [];

  if (ids.length) {
    const { data: msgs, error: msgErr } = await supabase
      .from("messages")
      .select("id, conversation_id, sender, body, confidence, sources, created_at")
      .in("conversation_id", ids)
      .order("created_at", { ascending: true })
      .limit(3000);
    if (msgErr) throw msgErr;
    messages = msgs ?? [];
  }

  const byConvo = new Map<string, typeof messages>();
  for (const m of messages) {
    const list = byConvo.get(m.conversation_id) || [];
    list.push(m);
    byConvo.set(m.conversation_id, list);
  }

  const sessions: LiveSession[] = rows.map((c) => {
    const msgs = byConvo.get(c.id as string) || [];
    const aiMsgs = msgs.filter((m) => m.sender === "ai");
    const lastAi = aiMsgs[aiMsgs.length - 1];
    const lastAiIdx = lastAi ? msgs.findIndex((m) => m.id === lastAi.id) : -1;
    const prev = lastAiIdx > 0 ? msgs[lastAiIdx - 1] : null;

    const conf =
      lastAi?.confidence != null
        ? Number(lastAi.confidence)
        : c.confidence != null
          ? Number(c.confidence)
          : aiMsgs.length
            ? 0.7
            : 0.5;

    const cust = c.customer as { name?: string; company?: string } | { name?: string; company?: string }[] | null;
    const custObj = Array.isArray(cust) ? cust[0] : cust;

    const tokens = msgs.reduce((sum, m) => sum + estimateTokens(m.body || ""), 0);
    const latency = lastAi ? latencyFromGap(prev?.created_at ?? null, lastAi.created_at) : 0;
    const lastAt = (c.last_message_at || c.updated_at || c.created_at) as string;

    return {
      id: c.id as string,
      externalRef: (c.external_ref as string) || `CV-${String(c.id).slice(0, 6)}`,
      customer: custObj?.name || (c.visitor_name as string) || "Visitor",
      company: custObj?.company || (c.visitor_company as string) || "",
      channel: c.channel as ChannelType,
      status: c.status as ConversationStatus,
      agentLabel: (c.assignee_label as string) || "AI · Support",
      confidence: conf,
      sources: sourceCount(lastAi?.sources),
      tokensEstimate: tokens,
      latencyMs: latency,
      memory: memoryFromMessages(msgs.length),
      escalation: escalationFromStatus(c.status as ConversationStatus, conf),
      preview: (c.preview as string) || (c.subject as string) || lastAi?.body?.slice(0, 80) || "—",
      lastActivity: lastAt,
      lastActivityLabel: formatRelativeTime(lastAt),
      messageCount: msgs.length,
      tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
    };
  });

  const live = sessions.filter((s) => s.status === "ai").length;
  const escalations = sessions.filter((s) => s.status === "escalated").length;
  const withConf = sessions.filter((s) => s.confidence > 0);
  const avgConfidence =
    withConf.length === 0
      ? 0
      : withConf.reduce((a, s) => a + s.confidence, 0) / withConf.length;
  const withLat = sessions.filter((s) => s.latencyMs > 0);
  const avgLatencyMs =
    withLat.length === 0
      ? 0
      : Math.round(withLat.reduce((a, s) => a + s.latencyMs, 0) / withLat.length);
  const channels = new Set(sessions.map((s) => s.channel)).size;

  return {
    sessions,
    kpis: {
      live: live || sessions.length,
      avgConfidence,
      avgLatencyMs,
      escalations,
      channels,
    },
  };
}

export async function getSessionTimeline(
  conversationId: string,
): Promise<{ events: SessionTimelineEvent[]; messages: DbMessage[] }> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;

  const messages = (data ?? []) as DbMessage[];
  const events: SessionTimelineEvent[] = [];

  if (messages.length) {
    const first = messages[0];
    events.push({
      id: `open-${first.id}`,
      t: new Date(first.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      label: "Session activity",
      detail: `First message · ${first.sender}`,
      tone: "neutral",
    });
  }

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const t = new Date(m.created_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    if (m.sender === "customer") {
      events.push({
        id: m.id,
        t,
        label: "Customer message",
        detail: m.body.slice(0, 120),
        tone: "info",
      });
    } else if (m.sender === "ai") {
      const src = Array.isArray(m.sources) ? m.sources.length : 0;
      const conf = m.confidence != null ? Number(m.confidence).toFixed(2) : "—";
      const prev = i > 0 ? messages[i - 1] : null;
      const lat = prev ? latencyFromGap(prev.created_at, m.created_at) : null;
      events.push({
        id: m.id,
        t,
        label: "AI response",
        detail: `${lat ? `${lat}ms · ` : ""}confidence ${conf}${src ? ` · ${src} sources` : ""}`,
        tone: Number(m.confidence) >= 0.8 ? "success" : Number(m.confidence) < 0.55 ? "warning" : "primary",
      });
    } else if (m.sender === "agent") {
      events.push({
        id: m.id,
        t,
        label: "Human agent reply",
        detail: m.body.slice(0, 120),
        tone: "warning",
      });
    } else if (m.sender === "system") {
      events.push({
        id: m.id,
        t,
        label: "System",
        detail: m.body.slice(0, 120),
        tone: "neutral",
      });
    }
  }

  return { events, messages };
}

export async function pauseSessionAi(conversationId: string, label = "Paused · Command Center") {
  const supabase = getBrowserSupabase();
  const { data: row } = await supabase
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .maybeSingle();
  const meta =
    row?.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  const { error } = await supabase
    .from("conversations")
    .update({
      status: "human",
      assignee_label: label,
      metadata: { ...meta, ai_paused_from: "command_center", handoff_reason: "Paused from Command Center" },
    })
    .eq("id", conversationId);
  if (error) throw error;
}

export async function resumeSessionAi(conversationId: string) {
  const supabase = getBrowserSupabase();
  const { data: row } = await supabase
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .maybeSingle();
  const meta =
    row?.metadata && typeof row.metadata === "object"
      ? { ...(row.metadata as Record<string, unknown>) }
      : {};
  delete meta.ai_paused_from;
  const { error } = await supabase
    .from("conversations")
    .update({
      status: "ai",
      assignee_id: null,
      assignee_label: "AI · Support Agent",
      metadata: meta,
    })
    .eq("id", conversationId);
  if (error) throw error;
}

export async function pauseAllLiveAi(orgId: string) {
  const supabase = getBrowserSupabase();
  const { data, error: listErr } = await supabase
    .from("conversations")
    .select("id, metadata")
    .eq("org_id", orgId)
    .eq("status", "ai")
    .limit(200);
  if (listErr) throw listErr;

  for (const row of data ?? []) {
    const meta =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {};
    const { error } = await supabase
      .from("conversations")
      .update({
        status: "human",
        assignee_label: "AI paused globally",
        metadata: {
          ...meta,
          ai_global_pause: true,
          handoff_reason: "Global AI pause from Command Center",
        },
      })
      .eq("id", row.id);
    if (error) throw error;
  }
  return (data ?? []).length;
}

export async function resumeAllPausedAi(orgId: string) {
  const supabase = getBrowserSupabase();
  const { data, error: listErr } = await supabase
    .from("conversations")
    .select("id, metadata, assignee_label")
    .eq("org_id", orgId)
    .eq("status", "human")
    .limit(200);
  if (listErr) throw listErr;

  const targets = (data ?? []).filter((row) => {
    const meta =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {};
    return meta.ai_global_pause === true || row.assignee_label === "AI paused globally";
  });

  for (const row of targets) {
    const meta =
      row.metadata && typeof row.metadata === "object"
        ? { ...(row.metadata as Record<string, unknown>) }
        : {};
    delete meta.ai_global_pause;
    delete meta.ai_paused_from;
    const { error } = await supabase
      .from("conversations")
      .update({
        status: "ai",
        assignee_id: null,
        assignee_label: "AI · Support Agent",
        metadata: meta,
      })
      .eq("id", row.id);
    if (error) throw error;
  }
  return targets.length;
}

export { CHANNEL_LABELS };
