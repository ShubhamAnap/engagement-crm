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
};

export type DashboardSnapshot = {
  kpis: DashboardKpi[];
  salesKpis: DashboardKpi[];
  conversationTrend: Array<{ day: string; ai: number; human: number }>;
  channelSplit: Array<{ name: string; value: number; key: string }>;
  leadFunnel: Array<{ stage: string; value: number }>;
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
};

const LEAD_FUNNEL_STAGES: LeadStatus[] = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won"];
const PIPELINE_STAGES: LeadStatus[] = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"];

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

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function countByStatus(leads: DbLead[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const lead of leads) {
    map[lead.status] = (map[lead.status] ?? 0) + 1;
  }
  return map;
}

export async function getDashboardSnapshot(orgId: string): Promise<DashboardSnapshot> {
  const supabase = getBrowserSupabase();
  const since7 = new Date();
  since7.setDate(since7.getDate() - 6);
  since7.setHours(0, 0, 0, 0);
  const todayStart = startOfDay(new Date()).toISOString();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    conversationsRes,
    leadsRes,
    customersRes,
    productsRes,
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select(
        "id, channel, status, preview, visitor_name, visitor_company, last_message_at, created_at, assignee_label",
      )
      .eq("org_id", orgId)
      .order("last_message_at", { ascending: false })
      .limit(500),
    supabase
      .from("leads")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId),
    supabase
      .from("products")
      .select("id, sku, name, category, price_label, ai_weight, created_at")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("ai_weight", { ascending: false })
      .limit(50),
  ]);

  if (conversationsRes.error) throw conversationsRes.error;
  if (leadsRes.error) throw leadsRes.error;
  if (customersRes.error) throw customersRes.error;
  if (productsRes.error) throw productsRes.error;

  const conversations = conversationsRes.data ?? [];
  const leads = (leadsRes.data ?? []) as DbLead[];
  const products = (productsRes.data ?? []) as Pick<
    DbProduct,
    "id" | "sku" | "name" | "category" | "price_label" | "ai_weight" | "created_at"
  >[];
  const customerCount = customersRes.count ?? 0;

  const activeConversations = conversations.filter((c) => c.status === "ai" || c.status === "human").length;
  const escalations = conversations.filter((c) => c.status === "escalated").length;
  const resolved = conversations.filter((c) => c.status === "resolved").length;
  const todayConversations = conversations.filter(
    (c) => (c.created_at && c.created_at >= todayStart) || (c.last_message_at && c.last_message_at >= todayStart),
  ).length;

  const aiOrResolved = conversations.filter((c) => c.status === "ai" || c.status === "resolved").length;
  const humanOrEscalated = conversations.filter((c) => c.status === "human" || c.status === "escalated").length;
  const denom = aiOrResolved + humanOrEscalated;
  const aiRate = denom > 0 ? (aiOrResolved / denom) * 100 : 0;
  const humanRate = denom > 0 ? (humanOrEscalated / denom) * 100 : 0;

  const leadCounts = countByStatus(leads);
  const openLeads = leads.filter((l) => l.status !== "Won" && l.status !== "Lost").length;
  const newThisMonth = leads.filter((l) => l.created_at >= monthStart.toISOString()).length;
  const qualifiedPlus = leads.filter((l) =>
    ["Qualified", "Proposal", "Negotiation", "Won"].includes(l.status),
  ).length;
  const won = leadCounts.Won ?? 0;

  // Trend: last 7 calendar days
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

  // Channel distribution (percent of conversations)
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
    .sort((a, b) => b.count - a.count)
    .map(({ key, name, value }) => ({ key, name, value }));

  if (channelSplit.length === 0) {
    channelSplit.push({ key: "website", name: "Website", value: 0 });
  }

  const leadFunnel = LEAD_FUNNEL_STAGES.map((stage) => ({
    stage,
    value: leadCounts[stage] ?? 0,
  }));

  const pipelineByStage = PIPELINE_STAGES.map((stage) => ({
    stage,
    value: leadCounts[stage] ?? 0,
  }));

  const recentConversations: DashboardConversation[] = conversations.slice(0, 6).map((c) => ({
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
  for (const c of conversations.slice(0, 4)) {
    activity.push({
      id: `c-${c.id}`,
      who: (c.assignee_label as string) || (c.status === "ai" ? "EnerBot" : "Agent"),
      what: `updated conversation with ${(c.visitor_name as string) || "visitor"} (${c.status})`,
      when: formatRelative((c.last_message_at as string) || (c.created_at as string)),
    });
  }
  for (const l of leads.slice(0, 3)) {
    activity.push({
      id: `l-${l.id}`,
      who: "Sales",
      what: `lead ${l.name}${l.company ? ` · ${l.company}` : ""} is ${l.status}`,
      when: formatRelative(l.updated_at || l.created_at),
    });
  }

  const kpis: DashboardKpi[] = [
    {
      label: "Active Conversations",
      value: String(activeConversations),
      hint: "AI or human open",
    },
    {
      label: "Today's Conversations",
      value: String(todayConversations),
      hint: "created or messaged today",
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
      value: String(products.length),
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
      hint: "closed won leads",
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
    pipelineByStage,
    recentConversations,
    recentLeads,
    recentProducts,
    activity: activity.slice(0, 8),
    totals: {
      conversations: conversations.length,
      leads: leads.length,
      customers: customerCount,
      products: products.length,
    },
  };
}
