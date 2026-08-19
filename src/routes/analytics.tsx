import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChannelIcon,
  EmptyState,
  PageHeader,
  Panel,
  Pill,
  ScoreBar,
  StatCard,
} from "@/components/shared/ui-kit";
import { getChannelBrand } from "@/lib/channel-brand";
import { useAuth } from "@/lib/auth";
import { getAnalyticsSnapshot, type AnalyticsRange } from "@/lib/analytics-api";

const axis = {
  stroke: "var(--color-muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};
const ts = {
  backgroundColor: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-popover-foreground)",
};

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics" },
      {
        name: "description",
        content: "Executive view of AI performance, conversion, channels, knowledge and team productivity.",
      },
      { property: "og:title", content: "Analytics" },
      {
        property: "og:description",
        content: "Executive view of AI performance, conversion, channels, knowledge and team productivity.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id;
  const [rangeDays, setRangeDays] = useState<AnalyticsRange>(30);

  const analyticsQuery = useQuery({
    queryKey: ["analytics", orgId, rangeDays],
    enabled: Boolean(orgId),
    queryFn: () => getAnalyticsSnapshot(orgId!, rangeDays),
  });

  const data = analyticsQuery.data;
  const loading = analyticsQuery.isLoading || !orgId;

  return (
    <>
      <PageHeader
        title="Analytics"
        meta={
          <>
            <Pill tone={analyticsQuery.isError ? "danger" : "success"} dot>
              {analyticsQuery.isError ? "Data error" : "Live"}
            </Pill>
            <Pill tone="neutral">Last {rangeDays} days</Pill>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={String(rangeDays)}
              onValueChange={(v) => setRangeDays(Number(v) as AnalyticsRange)}
            >
              <SelectTrigger className="h-8 w-[130px]">
                <SelectValue placeholder="Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={analyticsQuery.isFetching}
              onClick={async () => {
                await queryClient.invalidateQueries({ queryKey: ["analytics", orgId, rangeDays] });
                toast.success("Analytics refreshed");
              }}
            >
              <RefreshCw className={`size-3.5 ${analyticsQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => navigate({ to: "/reports" })}>
              Open reports
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-6">
        {analyticsQuery.isError ? (
          <EmptyState
            title="Could not load analytics"
            description={
              analyticsQuery.error instanceof Error
                ? analyticsQuery.error.message
                : "Check Supabase connection."
            }
            action={
              <Button size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["analytics", orgId, rangeDays] })}>
                Retry
              </Button>
            }
          />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(loading
            ? Array.from({ length: 4 }, () => ({ label: "…", value: "—" }))
            : data?.kpis ?? []
          ).map((k, i) => (
            <StatCard
              key={`${k.label}-${i}`}
              label={k.label}
              value={k.value}
              hint={typeof (k as Record<string, unknown>).hint === "string" ? String((k as Record<string, unknown>).hint) : undefined}
              delta={typeof (k as Record<string, unknown>).delta === "string" ? String((k as Record<string, unknown>).delta) : undefined}
              trend={
                (k as Record<string, unknown>).trend === "up" || (k as Record<string, unknown>).trend === "down"
                  ? ((k as Record<string, unknown>).trend as "up" | "down")
                  : undefined
              }
            />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Panel
            title="Conversation Trend"
            description={
              rangeDays <= 7
                ? `Daily · last ${rangeDays} days`
                : rangeDays <= 30
                  ? `Weekly buckets · last ${rangeDays} days`
                  : `Biweekly buckets · last ${rangeDays} days`
            }
          >
            {loading ? (
              <div className="grid h-[280px] place-items-center text-sm text-muted-foreground">Loading…</div>
            ) : (
              <div className="h-[280px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data?.conversationTrend ?? []}
                    margin={{ top: 8, right: 12, left: 0, bottom: rangeDays > 7 ? 8 : 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis
                      dataKey="day"
                      {...axis}
                      interval={0}
                      minTickGap={28}
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                      tickMargin={8}
                      padding={{ left: 8, right: 8 }}
                    />
                    <YAxis {...axis} width={36} allowDecimals={false} />
                    <RTooltip contentStyle={ts} />
                    <Area
                      type="monotone"
                      dataKey="ai"
                      name="AI"
                      stroke="var(--color-chart-1)"
                      fill="var(--color-chart-1)"
                      fillOpacity={0.18}
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="human"
                      name="Human"
                      stroke="var(--color-chart-2)"
                      fill="var(--color-chart-2)"
                      fillOpacity={0.14}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <Panel title="Lead Conversion Funnel" description={`Leads created in last ${rangeDays} days`}>
            {loading ? (
              <div className="grid h-[280px] place-items-center text-sm text-muted-foreground">Loading…</div>
            ) : (data?.totals.leads ?? 0) === 0 ? (
              <EmptyState title="No leads in range" description="Create deals in Pipeline or capture from chat." />
            ) : (
              <div className="h-[280px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data?.leadFunnel ?? []}
                    margin={{ top: 8, right: 8, left: 0, bottom: 48 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis
                      dataKey="stage"
                      {...axis}
                      interval={0}
                      angle={-28}
                      textAnchor="end"
                      height={56}
                      tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                      tickMargin={6}
                    />
                    <YAxis {...axis} width={36} allowDecimals={false} />
                    <RTooltip contentStyle={ts} cursor={{ fill: "var(--color-secondary)" }} />
                    <Bar dataKey="value" name="Leads" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <Panel title="Channel Performance" description="Conversation share by channel" bodyClassName="p-0">
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : (data?.channelPerformance.length ?? 0) === 0 ? (
              <div className="p-4">
                <EmptyState title="No channel data" description="Conversations in this range will appear here." />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data!.channelPerformance.map((c) => (
                  <li key={c.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: getChannelBrand(c.key).accent }}
                    />
                    <ChannelIcon channel={c.key} className="text-muted-foreground" />
                    <span className="flex-1">{c.name}</span>
                    <span className="num text-xs text-muted-foreground">{c.count}</span>
                    <ScoreBar score={Math.min(100, c.share)} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Most Asked Questions" description="From customer messages in range" bodyClassName="p-0">
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : (data?.topQuestions.length ?? 0) === 0 ? (
              <div className="p-4">
                <EmptyState title="No questions yet" description="Customer chat messages will cluster here." />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data!.topQuestions.map((q) => (
                  <li key={q.q} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="truncate">{q.q}</span>
                    <span className="num text-xs text-muted-foreground">
                      {q.count} · {q.resolvedPct}% resolved
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Agent Performance"
            description="By assignee / EnerBot on conversations in range"
            bodyClassName="p-0"
            className="lg:col-span-2"
          >
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : (data?.agentPerformance.length ?? 0) === 0 ? (
              <div className="p-4">
                <EmptyState title="No agent activity" description="Handled conversations will list here." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {["Executive / Agent", "Handled", "Resolved", "Escalated", "First response", "Resolution"].map(
                        (h) => (
                          <th key={h} className="px-4 py-2.5 font-medium">
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data!.agentPerformance.map((a) => (
                      <tr key={a.name} className="hover:bg-secondary/40">
                        <td className="px-4 py-3 font-medium">{a.name}</td>
                        <td className="num px-4 py-3">{a.handled}</td>
                        <td className="num px-4 py-3">{a.resolved}</td>
                        <td className="num px-4 py-3">{a.escalated}</td>
                        <td className="num px-4 py-3">{a.firstResponse}</td>
                        <td className="num px-4 py-3">{a.resolution}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
