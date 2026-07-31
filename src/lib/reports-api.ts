import { getBrowserSupabase } from "@/lib/supabase";
import type { LeadStatus } from "@/lib/db-types";

export type ReportRange = 7 | 30 | 90;

export type ReportId =
  | "conversations"
  | "pipeline"
  | "channels"
  | "ai_quality"
  | "escalations"
  | "lead_sources"
  | "automations";

export type ReportDefinition = {
  id: ReportId;
  name: string;
  description: string;
  format: "CSV";
  category: string;
};

export type ReportTable = {
  title: string;
  columns: string[];
  rows: string[][];
};

export type ReportResult = {
  id: ReportId;
  name: string;
  rangeDays: ReportRange;
  generatedAt: string;
  kpis: Array<{ label: string; value: string; hint?: string }>;
  tables: ReportTable[];
  csvFilename: string;
  csvContent: string;
};

export const REPORT_CATALOG: ReportDefinition[] = [
  {
    id: "conversations",
    name: "Conversation Summary",
    description: "Volume, status mix, and channel split for conversations in range.",
    format: "CSV",
    category: "Support",
  },
  {
    id: "pipeline",
    name: "Lead Pipeline & Conversion",
    description: "Lead stages, won/lost, and conversion rates.",
    format: "CSV",
    category: "Sales",
  },
  {
    id: "channels",
    name: "Channel Performance",
    description: "Conversations and leads by channel (Website, WhatsApp, IndiaMART, …).",
    format: "CSV",
    category: "Channels",
  },
  {
    id: "ai_quality",
    name: "AI Quality Snapshot",
    description: "AI vs human messages, escalation rate, resolution mix.",
    format: "CSV",
    category: "AI",
  },
  {
    id: "escalations",
    name: "Escalation / Human Handoff",
    description: "Escalated and human-handled conversations needing follow-up.",
    format: "CSV",
    category: "SLA",
  },
  {
    id: "lead_sources",
    name: "Lead Sources (incl. IndiaMART)",
    description: "Leads by source channel for remarketing analysis.",
    format: "CSV",
    category: "Sales",
  },
  {
    id: "automations",
    name: "Automation Runs",
    description: "Workflow run counts and success/failure in range.",
    format: "CSV",
    category: "Ops",
  },
];

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

const LEAD_STAGES: LeadStatus[] = [
  "New",
  "Contacted",
  "Qualified",
  "Proposal",
  "Negotiation",
  "Won",
  "Lost",
];

function rangeStart(days: ReportRange): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function tablesToCsv(tables: ReportTable[], meta: Record<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    lines.push(`${csvEscape(k)},${csvEscape(v)}`);
  }
  lines.push("");
  for (const table of tables) {
    lines.push(csvEscape(table.title));
    lines.push(table.columns.map(csvEscape).join(","));
    for (const row of table.rows) {
      lines.push(row.map((c) => csvEscape(String(c ?? ""))).join(","));
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function pct(n: number, d: number): string {
  if (!d) return "0%";
  return `${Math.round((n / d) * 1000) / 10}%`;
}

export async function generateReport(
  orgId: string,
  reportId: ReportId,
  rangeDays: ReportRange,
): Promise<ReportResult> {
  const def = REPORT_CATALOG.find((r) => r.id === reportId);
  if (!def) throw new Error("Unknown report");

  const supabase = getBrowserSupabase();
  const since = rangeStart(rangeDays).toISOString();
  const generatedAt = new Date().toISOString();

  const [
    convRes,
    leadRes,
    msgRes,
    autoRes,
    autoRunRes,
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, channel, status, subject, visitor_name, assignee_label, created_at, last_message_at, tags")
      .eq("org_id", orgId)
      .gte("created_at", since)
      .limit(2000),
    supabase
      .from("leads")
      .select("id, name, company, status, priority, source, score, product_label, created_at, next_follow_up_at")
      .eq("org_id", orgId)
      .gte("created_at", since)
      .limit(2000),
    supabase
      .from("messages")
      .select("id, sender, conversation_id, created_at")
      .eq("org_id", orgId)
      .gte("created_at", since)
      .limit(5000),
    supabase
      .from("automations")
      .select("id, name, status, trigger_type, run_count, success_count, last_run_at")
      .eq("org_id", orgId)
      .limit(200),
    supabase
      .from("automation_runs")
      .select("id, automation_id, status, trigger_type, created_at")
      .eq("org_id", orgId)
      .gte("created_at", since)
      .limit(2000),
  ]);

  // automations table may not exist yet — treat as empty
  const conversations = convRes.error ? [] : convRes.data ?? [];
  const leads = leadRes.error ? [] : leadRes.data ?? [];
  const messages = msgRes.error ? [] : msgRes.data ?? [];
  const automations = autoRes.error ? [] : autoRes.data ?? [];
  const automationRuns = autoRunRes.error ? [] : autoRunRes.data ?? [];

  let kpis: ReportResult["kpis"] = [];
  let tables: ReportTable[] = [];

  if (reportId === "conversations") {
    const byStatus = new Map<string, number>();
    const byChannel = new Map<string, number>();
    for (const c of conversations) {
      byStatus.set(c.status || "unknown", (byStatus.get(c.status || "unknown") || 0) + 1);
      byChannel.set(c.channel || "unknown", (byChannel.get(c.channel || "unknown") || 0) + 1);
    }
    kpis = [
      { label: "Conversations", value: String(conversations.length) },
      { label: "AI mode", value: String(byStatus.get("ai") || 0) },
      { label: "Human / escalated", value: String((byStatus.get("human") || 0) + (byStatus.get("escalated") || 0)) },
      { label: "Resolved / closed", value: String((byStatus.get("resolved") || 0) + (byStatus.get("closed") || 0)) },
    ];
    tables = [
      {
        title: "By status",
        columns: ["Status", "Count", "Share"],
        rows: [...byStatus.entries()].map(([k, v]) => [k, String(v), pct(v, conversations.length)]),
      },
      {
        title: "By channel",
        columns: ["Channel", "Count", "Share"],
        rows: [...byChannel.entries()].map(([k, v]) => [
          CHANNEL_LABELS[k] || k,
          String(v),
          pct(v, conversations.length),
        ]),
      },
      {
        title: "Recent conversations",
        columns: ["Customer", "Channel", "Status", "Subject", "Created"],
        rows: conversations.slice(0, 50).map((c) => [
          c.visitor_name || "—",
          CHANNEL_LABELS[c.channel || ""] || c.channel || "—",
          c.status || "—",
          c.subject || "—",
          c.created_at ? new Date(c.created_at).toLocaleString() : "—",
        ]),
      },
    ];
  }

  if (reportId === "pipeline") {
    const byStage = new Map<string, number>();
    for (const s of LEAD_STAGES) byStage.set(s, 0);
    for (const l of leads) {
      byStage.set(l.status || "New", (byStage.get(l.status || "New") || 0) + 1);
    }
    const won = byStage.get("Won") || 0;
    const lost = byStage.get("Lost") || 0;
    const closed = won + lost;
    kpis = [
      { label: "Leads in range", value: String(leads.length) },
      { label: "Won", value: String(won) },
      { label: "Lost", value: String(lost) },
      { label: "Win rate", value: pct(won, closed), hint: "Of closed deals" },
    ];
    tables = [
      {
        title: "Funnel",
        columns: ["Stage", "Count", "Share"],
        rows: LEAD_STAGES.map((s) => [
          s,
          String(byStage.get(s) || 0),
          pct(byStage.get(s) || 0, leads.length),
        ]),
      },
      {
        title: "Leads",
        columns: ["Name", "Company", "Status", "Priority", "Source", "Score", "Created"],
        rows: leads.slice(0, 100).map((l) => [
          l.name,
          l.company || "—",
          l.status,
          l.priority,
          CHANNEL_LABELS[l.source || ""] || l.source || "—",
          String(l.score ?? "—"),
          l.created_at ? new Date(l.created_at).toLocaleString() : "—",
        ]),
      },
    ];
  }

  if (reportId === "channels") {
    const convBy = new Map<string, number>();
    const leadBy = new Map<string, number>();
    for (const c of conversations) {
      convBy.set(c.channel || "unknown", (convBy.get(c.channel || "unknown") || 0) + 1);
    }
    for (const l of leads) {
      leadBy.set(l.source || "unknown", (leadBy.get(l.source || "unknown") || 0) + 1);
    }
    const keys = new Set([...convBy.keys(), ...leadBy.keys()]);
    kpis = [
      { label: "Active channels (conv)", value: String(convBy.size) },
      { label: "Lead sources", value: String(leadBy.size) },
      { label: "Conversations", value: String(conversations.length) },
      { label: "Leads", value: String(leads.length) },
    ];
    tables = [
      {
        title: "Channel mix",
        columns: ["Channel", "Conversations", "Leads"],
        rows: [...keys].map((k) => [
          CHANNEL_LABELS[k] || k,
          String(convBy.get(k) || 0),
          String(leadBy.get(k) || 0),
        ]),
      },
    ];
  }

  if (reportId === "ai_quality") {
    let ai = 0;
    let customer = 0;
    let agent = 0;
    let system = 0;
    for (const m of messages) {
      if (m.sender === "ai") ai += 1;
      else if (m.sender === "agent") agent += 1;
      else if (m.sender === "system") system += 1;
      else if (m.sender === "customer") customer += 1;
    }
    const escalated = conversations.filter((c) => c.status === "escalated").length;
    const resolved = conversations.filter((c) => c.status === "resolved" || c.status === "closed").length;
    kpis = [
      { label: "AI replies", value: String(ai) },
      { label: "Agent replies", value: String(agent) },
      { label: "Escalation rate", value: pct(escalated, conversations.length) },
      { label: "Resolved rate", value: pct(resolved, conversations.length) },
    ];
    tables = [
      {
        title: "Message mix",
        columns: ["Sender", "Count", "Share"],
        rows: [
          ["customer", String(customer), pct(customer, messages.length)],
          ["ai", String(ai), pct(ai, messages.length)],
          ["agent", String(agent), pct(agent, messages.length)],
          ["system", String(system), pct(system, messages.length)],
        ],
      },
      {
        title: "Conversation outcomes",
        columns: ["Status", "Count"],
        rows: ["ai", "human", "escalated", "resolved", "closed"].map((s) => [
          s,
          String(conversations.filter((c) => c.status === s).length),
        ]),
      },
    ];
  }

  if (reportId === "escalations") {
    const rows = conversations.filter((c) => c.status === "escalated" || c.status === "human");
    kpis = [
      { label: "Open handoffs", value: String(rows.length) },
      { label: "Escalated", value: String(rows.filter((c) => c.status === "escalated").length) },
      { label: "Human mode", value: String(rows.filter((c) => c.status === "human").length) },
      {
        label: "Share of conversations",
        value: pct(rows.length, conversations.length),
      },
    ];
    tables = [
      {
        title: "Handoff queue",
        columns: ["Customer", "Channel", "Status", "Assignee", "Subject", "Created"],
        rows: rows.slice(0, 100).map((c) => [
          c.visitor_name || "—",
          CHANNEL_LABELS[c.channel || ""] || c.channel || "—",
          c.status || "—",
          c.assignee_label || "—",
          c.subject || "—",
          c.created_at ? new Date(c.created_at).toLocaleString() : "—",
        ]),
      },
    ];
  }

  if (reportId === "lead_sources") {
    const bySource = new Map<string, number>();
    for (const l of leads) {
      bySource.set(l.source || "unknown", (bySource.get(l.source || "unknown") || 0) + 1);
    }
    const im = bySource.get("indiamart") || 0;
    kpis = [
      { label: "Leads", value: String(leads.length) },
      { label: "IndiaMART", value: String(im), hint: "Remarketing source" },
      { label: "Website", value: String(bySource.get("website") || 0) },
      { label: "Sources", value: String(bySource.size) },
    ];
    tables = [
      {
        title: "By source",
        columns: ["Source", "Count", "Share"],
        rows: [...bySource.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => [CHANNEL_LABELS[k] || k, String(v), pct(v, leads.length)]),
      },
      {
        title: "IndiaMART / high-priority leads",
        columns: ["Name", "Company", "Source", "Status", "Priority", "Product", "Follow-up"],
        rows: leads
          .filter((l) => l.source === "indiamart" || l.priority === "High")
          .slice(0, 100)
          .map((l) => [
            l.name,
            l.company || "—",
            CHANNEL_LABELS[l.source || ""] || l.source || "—",
            l.status,
            l.priority,
            l.product_label || "—",
            l.next_follow_up_at ? new Date(l.next_follow_up_at).toLocaleString() : "—",
          ]),
      },
    ];
  }

  if (reportId === "automations") {
    const ok = automationRuns.filter((r) => r.status === "success").length;
    const fail = automationRuns.filter((r) => r.status === "failed").length;
    const byAuto = new Map<string, { name: string; ok: number; fail: number }>();
    for (const a of automations) {
      byAuto.set(a.id, { name: a.name, ok: 0, fail: 0 });
    }
    for (const r of automationRuns) {
      const cur = byAuto.get(r.automation_id) || { name: r.automation_id, ok: 0, fail: 0 };
      if (r.status === "success") cur.ok += 1;
      else cur.fail += 1;
      byAuto.set(r.automation_id, cur);
    }
    kpis = [
      { label: "Workflows", value: String(automations.length) },
      { label: "Runs in range", value: String(automationRuns.length) },
      { label: "Success", value: String(ok) },
      { label: "Failed", value: String(fail) },
    ];
    tables = [
      {
        title: "Workflows",
        columns: ["Name", "Status", "Trigger", "Lifetime runs", "Success", "Last run"],
        rows: automations.map((a) => [
          a.name,
          a.status,
          a.trigger_type,
          String(a.run_count ?? 0),
          String(a.success_count ?? 0),
          a.last_run_at ? new Date(a.last_run_at).toLocaleString() : "—",
        ]),
      },
      {
        title: "Runs in period",
        columns: ["Workflow", "OK", "Failed"],
        rows: [...byAuto.values()].map((v) => [v.name, String(v.ok), String(v.fail)]),
      },
    ];
  }

  const csvFilename = `enertech-${reportId}-${rangeDays}d-${generatedAt.slice(0, 10)}.csv`;
  const csvContent = tablesToCsv(tables, {
    Report: def.name,
    Range: `Last ${rangeDays} days`,
    Generated: new Date(generatedAt).toLocaleString(),
    Organization: orgId,
  });

  return {
    id: reportId,
    name: def.name,
    rangeDays,
    generatedAt,
    kpis,
    tables,
    csvFilename,
    csvContent,
  };
}
