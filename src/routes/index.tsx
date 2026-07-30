import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, StatCard, ChannelIcon } from "@/components/shared/ui-kit";
import {
  activity,
  channelSplit,
  conversationTrend,
  conversations,
  kpis,
  leadFunnel,
  leads,
  pipelineByStage,
  products,
  revenueKpis,
} from "@/data/mock";
import { Download, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — EnerTech Engage" },
      {
        name: "description",
        content:
          "Live operations dashboard: conversations, AI resolution rate, escalations, leads and revenue for EnerTech UPS.",
      },
      { property: "og:title", content: "Dashboard — EnerTech Engage" },
      {
        property: "og:description",
        content: "Live operations dashboard for EnerTech UPS customer engagement.",
      },
    ],
  }),
  component: Dashboard,
});

const axis = {
  stroke: "var(--color-muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

const tooltipStyle = {
  backgroundColor: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-popover-foreground)",
};

function Dashboard() {
  return (
    <>
      <PageHeader
        title="Operations Dashboard"
        description="Everything happening across EnerTech's AI and human customer engagement, right now."
        meta={
          <>
            <Pill tone="success" dot>
              All systems operational
            </Pill>
            <Pill tone="neutral">Last 7 days</Pill>
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1.5">
              <RefreshCw className="size-4" /> Refresh
            </Button>
            <Button size="sm" className="gap-1.5">
              <Download className="size-4" /> Export
            </Button>
          </>
        }
      />

      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((k) => (
            <StatCard key={k.label} {...k} />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            title="Conversation Trend"
            description="AI-handled vs. human-handled volume"
            className="lg:col-span-2"
          >
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={conversationTrend}>
                <defs>
                  <linearGradient id="gAi" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gHuman" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} width={38} />
                <RTooltip contentStyle={tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="ai"
                  stroke="var(--color-chart-1)"
                  strokeWidth={2}
                  fill="url(#gAi)"
                />
                <Area
                  type="monotone"
                  dataKey="human"
                  stroke="var(--color-chart-2)"
                  strokeWidth={2}
                  fill="url(#gHuman)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Channel Distribution" description="Share of inbound volume">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={channelSplit}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="none"
                >
                  {channelSplit.map((_, i) => (
                    <Cell key={i} fill={`var(--color-chart-${i + 1})`} />
                  ))}
                </Pie>
                <RTooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="mt-2 space-y-1.5">
              {channelSplit.map((c, i) => (
                <li key={c.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: `var(--color-chart-${i + 1})` }}
                  />
                  <span className="text-muted-foreground">{c.name}</span>
                  <span className="num ml-auto font-medium">{c.value}%</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {revenueKpis.map((k) => (
            <StatCard key={k.label} {...k} />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Lead Funnel" description="Visitor to closed-won conversion">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={leadFunnel} layout="vertical" margin={{ left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" {...axis} />
                <YAxis type="category" dataKey="stage" {...axis} width={72} />
                <RTooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-secondary)" }} />
                <Bar dataKey="value" fill="var(--color-chart-1)" radius={[0, 6, 6, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Sales Pipeline" description="Open deals by stage">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={pipelineByStage}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="stage" {...axis} />
                <YAxis {...axis} width={38} />
                <RTooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-secondary)" }} />
                <Bar dataKey="value" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} barSize={34} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            title="Recent Conversations"
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link to="/inbox">Open inbox</Link>
              </Button>
            }
            bodyClassName="p-0"
            className="lg:col-span-2"
          >
            <ul className="divide-y divide-border">
              {conversations.slice(0, 5).map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/50">
                  <ChannelIcon channel={c.channel} className="shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {c.customer}{" "}
                      <span className="font-normal text-muted-foreground">· {c.company}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{c.preview}</p>
                  </div>
                  <Pill
                    tone={
                      c.status === "escalated"
                        ? "danger"
                        : c.status === "resolved"
                          ? "success"
                          : c.status === "human"
                            ? "info"
                            : "primary"
                    }
                  >
                    {c.status}
                  </Pill>
                  <span className="num w-10 shrink-0 text-right text-xs text-muted-foreground">
                    {c.time}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Recent Activity" bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {activity.map((a) => (
                <li key={a.what} className="px-4 py-3">
                  <p className="text-sm">
                    <span className="font-medium">{a.who}</span>{" "}
                    <span className="text-muted-foreground">{a.what}</span>
                  </p>
                  <p className="num mt-0.5 text-[11px] text-muted-foreground">{a.when}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Top Products" description="By AI recommendations this month" bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {products.slice(0, 5).map((p) => (
                <li key={p.sku} className="flex items-center gap-3 px-4 py-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-secondary text-[10px] font-semibold">
                    {p.sku.slice(3, 6)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.category}</p>
                  </div>
                  <span className="num text-sm">{p.price}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="Recent Leads"
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link to="/leads">View all</Link>
              </Button>
            }
            bodyClassName="p-0"
          >
            <ul className="divide-y divide-border">
              {leads.slice(0, 5).map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {l.company} · {l.product}
                    </p>
                  </div>
                  <span className="num text-sm">{l.value}</span>
                  <Pill tone={l.score >= 80 ? "success" : l.score >= 60 ? "warning" : "neutral"}>
                    {l.score}
                  </Pill>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
