import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { agentPerformance, channelSplit, conversationTrend, leadFunnel, topQuestions } from "@/data/mock";
const axis = { stroke: "var(--color-muted-foreground)", fontSize: 11, tickLine: false, axisLine: false };
const ts = { backgroundColor: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 10, fontSize: 12 };

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — EnerTech Engage" },
      { name: "description", content: "Executive view of AI performance, conversion, channels, knowledge and team productivity." },
      { property: "og:title", content: "Analytics — EnerTech Engage" },
      { property: "og:description", content: "Executive view of AI performance, conversion, channels, knowledge and team productivity." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Analytics" description="Executive view of AI performance, conversion, channels, knowledge and team productivity." actions={<Button size="sm">Schedule report</Button>} />
      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="AI Resolution Rate" value="78.4%" delta="+2.6pt" trend="up" />
          <StatCard label="Lead Conversion" value="18.2%" delta="+1.4pt" trend="up" />
          <StatCard label="Avg. Handle Time" value="7m 12s" delta="-42s" trend="down" />
          <StatCard label="CSAT" value="4.7/5" delta="+0.2" trend="up" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Conversation Trend">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={conversationTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="day" {...axis} /><YAxis {...axis} width={38} /><RTooltip contentStyle={ts} />
                <Area type="monotone" dataKey="ai" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.18} strokeWidth={2} />
                <Area type="monotone" dataKey="human" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.14} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Lead Conversion Funnel">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={leadFunnel}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} /><XAxis dataKey="stage" {...axis} /><YAxis {...axis} width={44} /><RTooltip contentStyle={ts} cursor={{ fill: "var(--color-secondary)" }} /><Bar dataKey="value" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Channel Performance" bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {channelSplit.map((c) => (
                <li key={c.name} className="flex items-center gap-3 px-4 py-2.5 text-sm"><ChannelIcon channel={c.key} className="text-muted-foreground" /><span className="flex-1">{c.name}</span><ScoreBar score={c.value * 2} /></li>
              ))}
            </ul>
          </Panel>
          <Panel title="Most Asked Questions" bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {topQuestions.map((q) => (
                <li key={q.q} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-sm"><span className="truncate">{q.q}</span><span className="num text-xs text-muted-foreground">{q.count} · {q.resolved}% resolved</span></li>
              ))}
            </ul>
          </Panel>
          <Panel title="Agent Performance" bodyClassName="p-0" className="lg:col-span-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr>{["Executive", "Handled", "CSAT", "First response", "Resolution"].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {agentPerformance.map((a) => (
                    <tr key={a.name} className="hover:bg-secondary/40"><td className="px-4 py-3 font-medium">{a.name}</td><td className="num px-4 py-3">{a.handled}</td><td className="num px-4 py-3">{a.csat}</td><td className="num px-4 py-3">{a.firstResponse}</td><td className="num px-4 py-3">{a.resolution}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
