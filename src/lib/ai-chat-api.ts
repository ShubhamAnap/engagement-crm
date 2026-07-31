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
};

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

function parseInspector(msg: DbMessage): Omit<
  AiAnswerRow,
  "message" | "conversationId" | "externalRef" | "customer" | "channel" | "agentLabel" | "preview" | "whenLabel"
> {
  const meta = (msg.metadata || {}) as Record<string, unknown>;
  const sources = parseSources(msg.sources);
  const confidence = msg.confidence != null ? Number(msg.confidence) : 0.7;
  const risk =
    meta.hallucination_risk === "High" || meta.hallucination_risk === "Medium" || meta.hallucination_risk === "Low"
      ? meta.hallucination_risk
      : confidence >= 0.8
        ? "Low"
        : confidence >= 0.65
          ? "Medium"
          : "High";
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
    grounded: meta.grounded === true || sources.length > 0,
  };
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
  const { data: convos, error: cErr } = await supabase
    .from("conversations")
    .select(
      "id, external_ref, channel, assignee_label, visitor_name, preview, customer:customers(name)",
    )
    .in("id", convoIds);
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
      ...parsed,
    };
  });
}

export async function getAiAnswerStats(orgId: string) {
  const rows = await listRecentAiAnswers(orgId, 100);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayRows = rows.filter((r) => new Date(r.message.created_at) >= today);
  const grounded = todayRows.filter((r) => r.grounded).length;
  const highRisk = todayRows.filter((r) => r.hallucinationRisk === "High").length;
  return {
    answersToday: todayRows.length || rows.length,
    groundedPct: todayRows.length ? Math.round((grounded / todayRows.length) * 1000) / 10 : 0,
    hallucinationFlags: highRisk,
    sampleSize: rows.length,
  };
}
