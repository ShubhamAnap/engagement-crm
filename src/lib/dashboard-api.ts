import { getBrowserSupabase } from "@/lib/supabase";
import type { ChannelType, ConversationStatus, DbLead, DbProduct, LeadStatus } from "@/lib/db-types";

export type DashboardKpi = {
  label: string;
  value: string;
  hint?: string;
  delta?: string;
  trend?: "up" | "down";
};

export type DashboardConversation = {
  id: string;
  customer: string;
  company: string;
  channel: string;
  preview: string;
  status: ConversationStatus;
  time: string;
};

export type DashboardActivity = {
  id: string;
  who: string;
  what: string;
  when: string;
  whenMs: number;
};

export type DashboardSnapshot = {
  kpis: DashboardKpi[];
  salesKpis: DashboardKpi[];
  conversationTrend: Array<{ day: string; ai: number; human: number }>;
  channelSplit: Array<{ name: string; value: number; key: string; count: number }>;
  leadFunnel: Array<{ stage: string; value: number }>;
  leadsBySource: Array<{ source: string; value: number; key: string }>;
  pipelineByStage: Array<{ stage: string; value: number }>;
  recentConversations: DashboardConversation[];
  recentLeads: Array<{
    id: string;
    name: string;
    company: string;
    product: string;
    value: string;
    score: number;
    status: LeadStatus;
  }>;
  recentProducts: Array<{ id: string; sku: string; name: string; category: string; price: string }>;
  activity: DashboardActivity[];
  totals: {
    conversations: number;
    leads: number;
    customers: number;
    products: number;
  };
};

const CHANNEL_LABELS: Record<string, string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  email: "Email",
  instagram: "Instagram",
  facebook: "Facebook",
  api: "API",
  webhook: "Webhook",
  indiamart: "IndiaMART",
  tradeindia: "TradeIndia",
  brainmine: "Brainmine",
};

const LEAD_FUNNEL_STAGES: LeadStatus[] = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won"];
const PIPELINE_STAGES: LeadStatus[] = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"];
const LEAD_SOURCES: ChannelType[] = [
  "website",
  "whatsapp",
  "email",
  "instagram",
  "facebook",
  "indiamart",
  "tradeindia",
  "brainmine",
  "api",
  "webhook",
];

type SupabaseClient = ReturnType<typeof getBrowserSupabase>;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Unique axis label for 7-day charts (avoids two "Mon" in the same week). */
function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

async function exactCount(
  supabase: SupabaseClient,
  table: "conversations" | "leads" | "products" | "customers",
  orgId: string,
  eqFilters?: Record<string, string | boolean>,
): Promise<number> {
  let q = supabase.from(table).select("id", { count: "exact", head: true }).eq("org_id", orgId);
  if (eqFilters) {
    for (const [key, value] of Object.entries(eqFilters)) {
      q = q.eq(key, value);
    }
  }
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export async function getDashboardSnapshot(orgId: string): Promise<DashboardSnapshot> {
  const supabase = getBrowserSupabase();
  const todayStart = startOfDay(new Date()).toISOString();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartIso = monthStart.toISOString();

  const [
    conversationsRes,
    leadsRes,
    productsRes,
    customerCount,
    productTotal,
    conversationTotal,
    leadTotal,
    statusAi,
    statusHuman,
    statusEscalated,
    statusResolved,
    todayConversationsRes,
    newThisMonthRes,
    ...leadStatusCounts
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select(
        "id, channel, status, preview, visitor_name, visitor_company, last_message_at, created_at, assignee_label",
      )
      .eq("org_id", orgId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(300),
    supabase
      .from("leads")
      .select("*")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(400),
    supabase
      .from("products")
      .select("id, sku, name, category, price_label, ai_weight, created_at")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("ai_weight", { ascending: false })
      .limit(8),
    exactCount(supabase, "customers", orgId),
    exactCount(supabase, "products", orgId, { is_active: true }),
    exactCount(supabase, "conversations", orgId),
    exactCount(supabase, "leads", orgId),
    exactCount(supabase, "conversations", orgId, { status: "ai" }),
    exactCount(supabase, "conversations", orgId, { status: "human" }),
    exactCount(supabase, "conversations", orgId, { status: "escalated" }),
    exactCount(supabase, "conversations", orgId, { status: "resolved" }),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .or(`created_at.gte.${todayStart},last_message_at.gte.${todayStart}`),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .gte("created_at", monthStartIso),
    ...PIPELINE_STAGES.map((status) => exactCount(supabase, "leads", orgId, { status })),
  ]);

  if (conversationsRes.error) throw conversationsRes.error;
  if (leadsRes.error) throw leadsRes.error;
  if (productsRes.error) throw productsRes.error;
  if (todayConversationsRes.error) throw todayConversationsRes.error;
  if (newThisMonthRes.error) throw newThisMonthRes.error;

  const [sourceCountList, unknownSourceRes] = await Promise.all([
    Promise.all(LEAD_SOURCES.map((source) => exactCount(supabase, "leads", orgId, { source }))),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("source", null),
  ]);
  if (unknownSourceRes.error) throw unknownSourceRes.error;

  const conversations = conversationsRes.data ?? [];
  const leads = (leadsRes.data ?? []) as DbLead[];
  const products = (productsRes.data ?? []) as Pick<
    DbProduct,
    "id" | "sku" | "name" | "category" | "price_label" | "ai_weight" | "created_at"
  >[];

  const leadCounts: Record<string, number> = {};
  PIPELINE_STAGES.forEach((stage, i) => {
    leadCounts[stage] = Number(leadStatusCounts[i] ?? 0);
  });

  const activeConversations = statusAi + statusHuman;
  const escalations = statusEscalated;
  const resolved = statusResolved;
  const todayConversations = todayConversationsRes.count ?? 0;
  const newThisMonth = newThisMonthRes.count ?? 0;

  const aiOrResolved = statusAi + statusResolved;
  const humanOrEscalated = statusHuman + statusEscalated;
  const denom = aiOrResolved + humanOrEscalated;
  const aiRate = denom > 0 ? (aiOrResolved / denom) * 100 : 0;
  const humanRate = denom > 0 ? (humanOrEscalated / denom) * 100 : 0;

  const openLeads =
    (leadCounts.New ?? 0) +
    (leadCounts.Contacted ?? 0) +
    (leadCounts.Qualified ?? 0) +
    (leadCounts.Proposal ?? 0) +
    (leadCounts.Negotiation ?? 0);
  const won = leadCounts.Won ?? 0;
  const qualifiedPlus =
    (leadCounts.Qualified ?? 0) +
    (leadCounts.Proposal ?? 0) +
    (leadCounts.Negotiation ?? 0) +
    won;

  // Trend: last 7 calendar days from recent conversations (by last activity)
  const conversationTrend: Array<{ day: string; ai: number; human: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    const start = startOfDay(day);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    let ai = 0;
    let human = 0;
    for (const c of conversations) {
      const ts = c.last_message_at || c.created_at;
      if (!ts) continue;
      const t = new Date(ts).getTime();
      if (t < start.getTime() || t >= end.getTime()) continue;
      if (c.status === "human" || c.status === "escalated") human += 1;
      else ai += 1;
    }
    conversationTrend.push({ day: dayLabel(start), ai, human });
  }

  // Channel distribution from recent activity window (last 300 by last_message_at)
  const channelCounts: Record<string, number> = {};
  for (const c of conversations) {
    const key = (c.channel as ChannelType) || "website";
    channelCounts[key] = (channelCounts[key] ?? 0) + 1;
  }
  const channelTotal = conversations.length || 1;
  const channelSplit = Object.entries(channelCounts)
    .map(([key, count]) => ({
      key,
      name: CHANNEL_LABELS[key] || key,
      value: Math.round((count / channelTotal) * 100),
      count,
    }))
    .sort((a, b) => b.count - a.count);

  if (channelSplit.length === 0) {
    channelSplit.push({ key: "website", name: "Website", value: 0, count: 0 });
  }

  const leadFunnel = LEAD_FUNNEL_STAGES.map((stage) => ({
    stage,
    value: leadCounts[stage] ?? 0,
  }));

  const leadsBySource = LEAD_SOURCES.map((key, i) => ({
    key,
    source: CHANNEL_LABELS[key] || key,
    value: Number(sourceCountList[i] ?? 0),
  }))
    .concat(
      (unknownSourceRes.count ?? 0) > 0
        ? [{ key: "unknown", source: "Unknown", value: unknownSourceRes.count ?? 0 }]
        : [],
    )
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  const pipelineByStage = PIPELINE_STAGES.map((stage) => ({
    stage,
    value: leadCounts[stage] ?? 0,
  }));

  const recentConversations: DashboardConversation[] = conversations.slice(0, 8).map((c) => ({
    id: c.id as string,
    customer: (c.visitor_name as string) || "Visitor",
    company: (c.visitor_company as string) || "—",
    channel: (c.channel as string) || "website",
    preview: (c.preview as string) || "No messages yet",
    status: c.status as ConversationStatus,
    time: formatRelative((c.last_message_at as string) || (c.created_at as string)),
  }));

  const recentLeads = leads.slice(0, 6).map((l) => ({
    id: l.id,
    name: l.name,
    company: l.company || "—",
    product: l.product_label || "—",
    value: l.value_label || "—",
    score: Math.round(Number(l.score) || 0),
    status: l.status,
  }));

  const recentProducts = products.slice(0, 5).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category || "—",
    price: p.price_label || "—",
  }));

  const activity: DashboardActivity[] = [];
  for (const c of conversations.slice(0, 6)) {
    const whenIso = (c.last_message_at as string) || (c.created_at as string);
    activity.push({
      id: `c-${c.id}`,
      who: (c.assignee_label as string) || (c.status === "ai" ? "EnerBot" : "Agent"),
      what: `updated conversation with ${(c.visitor_name as string) || "visitor"} (${c.status})`,
      when: formatRelative(whenIso),
      whenMs: whenIso ? new Date(whenIso).getTime() : 0,
    });
  }
  for (const l of leads.slice(0, 4)) {
    const whenIso = l.updated_at || l.created_at;
    activity.push({
      id: `l-${l.id}`,
      who: "Sales",
      what: `lead ${l.name}${l.company ? ` · ${l.company}` : ""} is ${l.status}`,
      when: formatRelative(whenIso),
      whenMs: whenIso ? new Date(whenIso).getTime() : 0,
    });
  }
  activity.sort((a, b) => b.whenMs - a.whenMs);

  const kpis: DashboardKpi[] = [
    {
      label: "Active Conversations",
      value: String(activeConversations),
      hint: "AI or human open",
    },
    {
      label: "Today's Conversations",
      value: String(todayConversations),
      hint: "created or active today",
    },
    {
      label: "Pending Escalations",
      value: String(escalations),
      hint: "waiting on human",
      trend: escalations > 0 ? "up" : undefined,
      delta: escalations > 0 ? String(escalations) : undefined,
    },
    {
      label: "Resolved",
      value: String(resolved),
      hint: "closed threads",
    },
    {
      label: "AI Share",
      value: `${aiRate.toFixed(0)}%`,
      hint: "ai + resolved vs human + escalated",
    },
    {
      label: "Human Share",
      value: `${humanRate.toFixed(0)}%`,
      hint: "human + escalated",
    },
    {
      label: "Customers",
      value: String(customerCount),
      hint: "CRM records",
    },
    {
      label: "Products",
      value: String(productTotal),
      hint: "active catalog",
    },
  ];

  const salesKpis: DashboardKpi[] = [
    {
      label: "New Leads (MTD)",
      value: String(newThisMonth),
      hint: "created this month",
    },
    {
      label: "Qualified+",
      value: String(qualifiedPlus),
      hint: "qualified through won",
    },
    {
      label: "Open Opportunities",
      value: String(openLeads),
      hint: "not won/lost",
    },
    {
      label: "Won",
      value: String(won),
      hint: "closed won",
      trend: won > 0 ? "up" : undefined,
      delta: won > 0 ? String(won) : undefined,
    },
  ];

  return {
    kpis,
    salesKpis,
    conversationTrend,
    channelSplit,
    leadFunnel,
    leadsBySource,
    pipelineByStage,
    recentConversations,
    recentLeads,
    recentProducts,
    activity: activity.slice(0, 8),
    totals: {
      conversations: conversationTotal,
      leads: leadTotal,
      customers: customerCount,
      products: productTotal,
    },
  };
}
