import { getBrowserSupabase } from "@/lib/supabase";
import type { ChannelType, DbLead, LeadStatus } from "@/lib/db-types";

export type AnalyticsRange = 7 | 30 | 90;

export type AnalyticsKpi = {
  label: string;
  value: string;
  hint?: string;
  delta?: string;
  trend?: "up" | "down";
};

export type AnalyticsSnapshot = {
  rangeDays: AnalyticsRange;
  kpis: AnalyticsKpi[];
  conversationTrend: Array<{ day: string; ai: number; human: number; total: number }>;
  leadFunnel: Array<{ stage: string; value: number }>;
  channelPerformance: Array<{ key: string; name: string; count: number; share: number }>;
  topQuestions: Array<{ q: string; count: number; resolvedPct: number }>;
  agentPerformance: Array<{
    name: string;
    handled: number;
    resolved: number;
    escalated: number;
    resolution: string;
    firstResponse: string;
  }>;
  totals: {
    conversations: number;
    leads: number;
    messages: number;
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

const LEAD_FUNNEL_STAGES: LeadStatus[] = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won"];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayLabel(d: Date, mode: "weekday" | "week"): string {
  if (mode === "weekday") {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** 7d = daily; 30d = weekly; 90d = biweekly — keeps axis labels readable. */
function buildConversationTrend(
  conversations: Array<{ status: string | null; created_at: string | null; last_message_at: string | null }>,
  rangeDays: AnalyticsRange,
): Array<{ day: string; ai: number; human: number; total: number }> {
  const stepDays = rangeDays <= 7 ? 1 : rangeDays <= 30 ? 7 : 14;
  const bucketCount = Math.ceil(rangeDays / stepDays);
  const labelMode = stepDays === 1 ? "weekday" : "week";
  const trend: Array<{ day: string; ai: number; human: number; total: number }> = [];
  const today = startOfDay(new Date());

  for (let i = bucketCount - 1; i >= 0; i--) {
    const end = new Date(today);
    end.setDate(today.getDate() - i * stepDays);
    const start = new Date(end);
    start.setDate(end.getDate() - (stepDays - 1));
    const endExclusive = new Date(end);
    endExclusive.setDate(end.getDate() + 1);

    let ai = 0;
    let human = 0;
    for (const c of conversations) {
      const ts = c.last_message_at || c.created_at;
      if (!ts) continue;
      const t = new Date(ts).getTime();
      if (t < start.getTime() || t >= endExclusive.getTime()) continue;
      if (c.status === "human" || c.status === "escalated") human += 1;
      else ai += 1;
    }

    trend.push({
      day: dayLabel(stepDays === 1 ? end : start, labelMode),
      ai,
      human,
      total: ai + human,
    });
  }

  return trend;
}

function normalizeQuestion(body: string): string {
  const cleaned = body.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 72) return cleaned;
  return `${cleaned.slice(0, 69)}…`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

export async function getAnalyticsSnapshot(
  orgId: string,
  rangeDays: AnalyticsRange = 30,
): Promise<AnalyticsSnapshot> {
  const supabase = getBrowserSupabase();
  const since = startOfDay(new Date());
  since.setDate(since.getDate() - (rangeDays - 1));
  const sinceIso = since.toISOString();

  const [conversationsRes, leadsRes, messagesRes] = await Promise.all([
    supabase
      .from("conversations")
      .select(
        "id, channel, status, preview, visitor_name, assignee_label, created_at, last_message_at, updated_at",
      )
      .eq("org_id", orgId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("leads")
      .select("id, status, created_at, updated_at")
      .eq("org_id", orgId)
      .gte("created_at", sinceIso)
      .limit(1000),
    supabase
      .from("messages")
      .select("id, conversation_id, sender, body, created_at")
      .eq("org_id", orgId)
      .eq("sender", "customer")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(400),
  ]);

  if (conversationsRes.error) throw conversationsRes.error;
  if (leadsRes.error) throw leadsRes.error;
  if (messagesRes.error) throw messagesRes.error;

  const conversations = conversationsRes.data ?? [];
  const leads = (leadsRes.data ?? []) as Pick<DbLead, "id" | "status" | "created_at" | "updated_at">[];
  const messages = messagesRes.data ?? [];

  const totalConv = conversations.length;
  const aiLike = conversations.filter((c) => c.status === "ai" || c.status === "resolved").length;
  const humanLike = conversations.filter((c) => c.status === "human" || c.status === "escalated").length;
  const denom = aiLike + humanLike;
  const aiRate = denom > 0 ? (aiLike / denom) * 100 : 0;

  const won = leads.filter((l) => l.status === "Won").length;
  const conversion = leads.length > 0 ? (won / leads.length) * 100 : 0;

  // Avg handle time: created → last_message for resolved/human threads
  const handleSamples = conversations
    .filter((c) => c.status === "resolved" || c.status === "human")
    .map((c) => {
      const start = new Date(c.created_at as string).getTime();
      const end = new Date((c.last_message_at as string) || (c.updated_at as string) || (c.created_at as string)).getTime();
      return end - start;
    })
    .filter((ms) => ms > 0 && ms < 1000 * 60 * 60 * 24 * 14);
  const avgHandle =
    handleSamples.length > 0 ? handleSamples.reduce((a, b) => a + b, 0) / handleSamples.length : 0;

  const kpis: AnalyticsKpi[] = [
    {
      label: "AI Resolution Share",
      value: `${aiRate.toFixed(1)}%`,
      hint: `Last ${rangeDays} days · ai+resolved vs human+escalated`,
    },
    {
      label: "Lead Conversion",
      value: `${conversion.toFixed(1)}%`,
      hint: `${won} won of ${leads.length} leads in range`,
      trend: won > 0 ? "up" : undefined,
      delta: won > 0 ? `${won} won` : undefined,
    },
    {
      label: "Avg. Handle Time",
      value: formatDuration(avgHandle),
      hint: handleSamples.length ? `From ${handleSamples.length} closed/human threads` : "Not enough closed threads",
    },
    {
      label: "Conversations",
      value: String(totalConv),
      hint: `Created in last ${rangeDays} days`,
    },
  ];

  const conversationTrend = buildConversationTrend(
    conversations.map((c) => ({
      status: (c.status as string) || null,
      created_at: (c.created_at as string) || null,
      last_message_at: (c.last_message_at as string) || null,
    })),
    rangeDays,
  );

  const leadCounts: Record<string, number> = {};
  for (const lead of leads) {
    leadCounts[lead.status] = (leadCounts[lead.status] ?? 0) + 1;
  }
  const leadFunnel = LEAD_FUNNEL_STAGES.map((stage) => ({
    stage,
    value: leadCounts[stage] ?? 0,
  }));

  const channelCounts: Record<string, number> = {};
  for (const c of conversations) {
    const key = (c.channel as ChannelType) || "website";
    channelCounts[key] = (channelCounts[key] ?? 0) + 1;
  }
  const channelPerformance = Object.entries(channelCounts)
    .map(([key, count]) => ({
      key,
      name: CHANNEL_LABELS[key] || key,
      count,
      share: totalConv > 0 ? Math.round((count / totalConv) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Top customer questions (normalize first customer message-ish bodies)
  const questionMap = new Map<string, { label: string; count: number; resolved: number }>();
  const convStatus = new Map(conversations.map((c) => [c.id as string, c.status as string]));
  for (const m of messages) {
    const label = normalizeQuestion(String(m.body || ""));
    if (label.length < 8) continue;
    const key = label.toLowerCase();
    const prev = questionMap.get(key) || { label, count: 0, resolved: 0 };
    prev.count += 1;
    if (convStatus.get(m.conversation_id as string) === "resolved") prev.resolved += 1;
    questionMap.set(key, prev);
  }
  const topQuestions = [...questionMap.values()]
    .map((v) => ({
      q: v.label,
      count: v.count,
      resolvedPct: v.count > 0 ? Math.round((v.resolved / v.count) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Agent / assignee performance
  const agentMap = new Map<
    string,
    { handled: number; resolved: number; escalated: number; firstMs: number[]; }
  >();
  for (const c of conversations) {
    const name =
      (c.assignee_label as string)?.trim() ||
      (c.status === "ai" ? "EnerBot (AI)" : c.status === "human" ? "Human agent" : "Unassigned");
    const row = agentMap.get(name) || { handled: 0, resolved: 0, escalated: 0, firstMs: [] };
    row.handled += 1;
    if (c.status === "resolved") row.resolved += 1;
    if (c.status === "escalated") row.escalated += 1;
    const created = new Date(c.created_at as string).getTime();
    const last = new Date((c.last_message_at as string) || (c.created_at as string)).getTime();
    if (last > created) row.firstMs.push(last - created);
    agentMap.set(name, row);
  }
  const agentPerformance = [...agentMap.entries()]
    .map(([name, v]) => {
      const avgFirst =
        v.firstMs.length > 0 ? v.firstMs.reduce((a, b) => a + b, 0) / v.firstMs.length : 0;
      return {
        name,
        handled: v.handled,
        resolved: v.resolved,
        escalated: v.escalated,
        resolution: v.handled > 0 ? `${Math.round((v.resolved / v.handled) * 100)}%` : "—",
        firstResponse: formatDuration(avgFirst),
      };
    })
    .sort((a, b) => b.handled - a.handled)
    .slice(0, 12);

  return {
    rangeDays,
    kpis,
    conversationTrend,
    leadFunnel,
    channelPerformance,
    topQuestions,
    agentPerformance,
    totals: {
      conversations: totalConv,
      leads: leads.length,
      messages: messages.length,
    },
  };
}
