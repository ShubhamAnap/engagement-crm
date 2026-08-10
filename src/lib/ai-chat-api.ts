import { getBrowserSupabase } from "@/lib/supabase";
import type { ChannelType, DbMessage } from "@/lib/db-types";
import { formatRelativeTime } from "@/lib/chat-api";

export type InspectorSource = {
  title: string;
  score: number;
  url?: string | null;
};

export type AiAnswerRow = {
  message: DbMessage;
  conversationId: string;
  externalRef: string;
  customer: string;
  channel: ChannelType;
  agentLabel: string;
  preview: string;
  whenLabel: string;
  confidence: number;
  sources: InspectorSource[];
  hallucinationRisk: "Low" | "Medium" | "High";
  reasoning: string[];
  memory: string;
  model: string;
  grounded: boolean;
  /** Customer message immediately before this AI reply (if found). */
  customerQuestion: string | null;
};

export type AiAnswerStats = {
  answersToday: number;
  groundedPct: number;
  hallucinationFlags: number;
  sampleSize: number;
};

function startOfTodayIso(): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
}

function parseSources(raw: unknown): InspectorSource[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") {
        return { title: item, score: 0.7, url: null };
      }
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        return {
          title: String(o.title || o.name || "Source"),
          score: Number(o.score ?? o.similarity ?? 0.7),
          url: (o.url as string) || null,
        };
      }
      return null;
    })
    .filter(Boolean) as InspectorSource[];
}

function riskFromMessage(msg: Pick<DbMessage, "confidence" | "metadata" | "sources">): "Low" | "Medium" | "High" {
  const meta = (msg.metadata || {}) as Record<string, unknown>;
  if (meta.hallucination_risk === "High" || meta.hallucination_risk === "Medium" || meta.hallucination_risk === "Low") {
    return meta.hallucination_risk;
  }
  const confidence = msg.confidence != null ? Number(msg.confidence) : 0.7;
  const sources = parseSources(msg.sources);
  const grounded = meta.grounded === true || sources.length > 0;
  if (!grounded) return "High";
  if (confidence >= 0.8) return "Low";
  if (confidence >= 0.65) return "Medium";
  return "High";
}

function isGroundedMessage(msg: Pick<DbMessage, "metadata" | "sources">): boolean {
  const meta = (msg.metadata || {}) as Record<string, unknown>;
  const sources = parseSources(msg.sources);
  return meta.grounded === true || sources.length > 0;
}

function parseInspector(msg: DbMessage): Omit<
  AiAnswerRow,
  | "message"
  | "conversationId"
  | "externalRef"
  | "customer"
  | "channel"
  | "agentLabel"
  | "preview"
  | "whenLabel"
  | "customerQuestion"
> {
  const meta = (msg.metadata || {}) as Record<string, unknown>;
  const sources = parseSources(msg.sources);
  const confidence = msg.confidence != null ? Number(msg.confidence) : 0.7;
  const risk = riskFromMessage(msg);
  const reasoning = Array.isArray(meta.reasoning)
    ? meta.reasoning.map(String)
    : [
        "Intent handled by configured Support / specialist stack.",
        sources.length
          ? `Grounded on ${sources.length} knowledge source(s).`
          : "Limited grounding — general guidance path.",
        `Confidence ${confidence.toFixed(2)}.`,
      ];
  return {
    confidence,
    sources,
    hallucinationRisk: risk,
    reasoning,
    memory: typeof meta.memory === "string" ? meta.memory : "Session memory from conversation history.",
    model: typeof meta.model === "string" ? meta.model : "gpt-4o-mini",
    grounded: isGroundedMessage(msg),
  };
}

async function loadPriorCustomerQuestions(
  orgId: string,
  aiMessages: DbMessage[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!aiMessages.length) return out;

  const supabase = getBrowserSupabase();
  const convoIds = [...new Set(aiMessages.map((m) => m.conversation_id))];
  const oldestAiMs = Math.min(...aiMessages.map((m) => new Date(m.created_at).getTime()));
  // Look back so the question just before the oldest AI reply is still included
  const sinceIso = new Date(oldestAiMs - 48 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, body, created_at, sender")
    .eq("org_id", orgId)
    .eq("sender", "customer")
    .in("conversation_id", convoIds)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error || !data?.length) return out;

  const byConvo = new Map<string, Array<{ id: string; conversation_id: string; body: string; created_at: string }>>();
  for (const row of data) {
    const list = byConvo.get(row.conversation_id as string) ?? [];
    list.push(row as { id: string; conversation_id: string; body: string; created_at: string });
    byConvo.set(row.conversation_id as string, list);
  }

  for (const ai of aiMessages) {
    const prior = byConvo.get(ai.conversation_id) ?? [];
    let best: { body: string; created_at: string } | null = null;
    for (const m of prior) {
      if (m.created_at >= ai.created_at) continue;
      if (!best || m.created_at > best.created_at) best = m;
    }
    if (best?.body) out.set(ai.id, best.body);
  }
  return out;
}

export async function listRecentAiAnswers(orgId: string, limit = 40): Promise<AiAnswerRow[]> {
  const supabase = getBrowserSupabase();
  const { data: messages, error } = await supabase
    .from("messages")
    .select("*")
    .eq("org_id", orgId)
    .eq("sender", "ai")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const msgs = (messages ?? []) as DbMessage[];
  if (!msgs.length) return [];

  const convoIds = [...new Set(msgs.map((m) => m.conversation_id))];
  const [{ data: convos, error: cErr }, questionsByAiId] = await Promise.all([
    supabase
      .from("conversations")
      .select(
        "id, external_ref, channel, assignee_label, visitor_name, preview, customer:customers(name)",
      )
      .in("id", convoIds),
    loadPriorCustomerQuestions(orgId, msgs),
  ]);
  if (cErr) throw cErr;

  const byId = new Map((convos ?? []).map((c) => [c.id as string, c]));

  return msgs.map((m) => {
    const c = byId.get(m.conversation_id);
    const cust = c?.customer as { name?: string } | { name?: string }[] | null;
    const custObj = Array.isArray(cust) ? cust[0] : cust;
    const parsed = parseInspector(m);
    return {
      message: m,
      conversationId: m.conversation_id,
      externalRef: (c?.external_ref as string) || `CV-${m.conversation_id.slice(0, 6)}`,
      customer: custObj?.name || (c?.visitor_name as string) || "Visitor",
      channel: (c?.channel as ChannelType) || "website",
      agentLabel: (c?.assignee_label as string) || "AI · Support",
      preview: m.body.slice(0, 160),
      whenLabel: formatRelativeTime(m.created_at),
      customerQuestion: questionsByAiId.get(m.id) ?? null,
      ...parsed,
    };
  });
}

export async function getAiAnswerStats(orgId: string): Promise<AiAnswerStats> {
  const supabase = getBrowserSupabase();
  const since = startOfTodayIso();

  const [answersTodayRes, todayMsgsRes, sampleRows] = await Promise.all([
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("sender", "ai")
      .gte("created_at", since),
    supabase
      .from("messages")
      .select("id, confidence, sources, metadata, created_at")
      .eq("org_id", orgId)
      .eq("sender", "ai")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500),
    listRecentAiAnswers(orgId, 100),
  ]);

  if (answersTodayRes.error) throw answersTodayRes.error;
  if (todayMsgsRes.error) throw todayMsgsRes.error;

  const answersToday = answersTodayRes.count ?? 0;
  const todayMsgs = (todayMsgsRes.data ?? []) as Array<
    Pick<DbMessage, "id" | "confidence" | "sources" | "metadata" | "created_at">
  >;
  const grounded = todayMsgs.filter((m) => isGroundedMessage(m)).length;
  const highRisk = todayMsgs.filter((m) => riskFromMessage(m) === "High").length;

  return {
    answersToday,
    groundedPct: todayMsgs.length ? Math.round((grounded / todayMsgs.length) * 1000) / 10 : 0,
    hallucinationFlags: highRisk,
    sampleSize: sampleRows.length,
  };
}
