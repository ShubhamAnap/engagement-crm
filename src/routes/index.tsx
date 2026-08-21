import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChannelIcon, EmptyState, PageHeader, Panel, Pill, StatCard } from "@/components/shared/ui-kit";
import { getChannelBrand } from "@/lib/channel-brand";
import { useAuth } from "@/lib/auth";
import { describeLoadError, featureNotSetUp } from "@/lib/feature-setup";
import { downloadCsv } from "@/lib/csv";
import { getDashboardSnapshot } from "@/lib/dashboard-api";
import { getSpendSnapshot } from "@/lib/spend-api";
import { GettingStartedChecklist } from "@/components/dashboard/GettingStartedChecklist";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard" },
      {
        name: "description",
        content:
          "Live operations dashboard: conversations, AI vs human share, escalations, leads and catalog.",
      },
      { property: "og:title", content: "Dashboard" },
      {
        property: "og:description",
        content:
          "Live operations dashboard: conversations, AI vs human share, escalations, leads and catalog.",
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const orgId = profile?.org.id;
  const isAdmin = profile?.role === "Admin";

  const dashboardQuery = useQuery({
    queryKey: ["dashboard", orgId],
    enabled: Boolean(orgId),
    queryFn: () => getDashboardSnapshot(orgId!),
    refetchInterval: 60_000,
  });

  const spendQuery = useQuery({
    queryKey: ["dashboard-spend", orgId],
    enabled: Boolean(orgId) && isAdmin,
    queryFn: () => getSpendSnapshot(orgId!),
    refetchInterval: 60_000,
  });

  const data = dashboardQuery.data;
  const loading = dashboardQuery.isLoading || !orgId;
  const firstName = (profile?.fullName || "").trim().split(/\s+/)[0] || "there";
  const allKpis = loading
    ? Array.from({ length: 8 }, (_, i) => ({ label: "…", value: "—" }))
    : data?.kpis ?? [];
  const primaryKpis = allKpis.slice(0, 4);
  const secondaryKpis = allKpis.slice(4);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Good to see you, ${firstName}. Here’s how your workspace is running.`}
        meta={
          <>
            <Pill tone={dashboardQuery.isError ? "danger" : "success"} dot>
              {dashboardQuery.isError ? "Data error" : "Live data"}
            </Pill>
            <Pill tone="neutral">Last 7 days trend</Pill>
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={dashboardQuery.isFetching}
              onClick={async () => {
                await queryClient.invalidateQueries({ queryKey: ["dashboard", orgId] });
                if (isAdmin) await queryClient.invalidateQueries({ queryKey: ["dashboard-spend", orgId] });
                toast.success("Dashboard refreshed");
              }}
            >
              <RefreshCw className={`size-4 ${dashboardQuery.isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!data}
              onClick={() => {
                if (!data) {
                  toast.message("Dashboard still loading");
                  return;
                }
                const rows: string[][] = [["Metric", "Value", "Delta", "Hint"]];
                for (const k of data.kpis ?? []) {
                  rows.push([
                    k.label,
                    String(k.value),
                    "delta" in k && k.delta != null ? String(k.delta) : "",
                    "hint" in k && k.hint != null ? String(k.hint) : "",
                  ]);
                }
                rows.push([]);
                rows.push(["Channel", "Share %", "Count (recent)"]);
                for (const c of data.channelSplit ?? []) {
                  rows.push([c.name, String(c.value), String(c.count)]);
                }
                rows.push([]);
                rows.push(["Lead source", "Count"]);
                for (const s of data.leadsBySource ?? []) {
                  rows.push([s.source, String(s.value)]);
                }
                downloadCsv(
                  `enertech-dashboard-${new Date().toISOString().slice(0, 10)}.csv`,
                  rows,
                );
                toast.success("Dashboard CSV downloaded", {
                  description: "For full reports, open Analytics or Reports.",
                  action: {
                    label: "Reports",
                    onClick: () => {
                      void navigate({ to: "/reports" });
                    },
                  },
                });
              }}
            >
              <Download className="size-4" /> Export
            </Button>
          </>
        }
      />

      <div className="space-y-6 p-6">
        {orgId ? <GettingStartedChecklist orgId={orgId} /> : null}
        {dashboardQuery.isError ? (
          <EmptyState
            title="Could not load dashboard"
            description={dashboardQuery.error instanceof Error ? dashboardQuery.error.message : "Check Supabase connection."}
            action={
              <Button size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["dashboard", orgId] })}>
                Retry
              </Button>
            }
          />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {primaryKpis.map((k, i) => (
            <StatCard
              key={`${k.label}-${i}`}
              label={k.label}
              value={k.value}
              delta={typeof (k as Record<string, unknown>).delta === "string" ? String((k as Record<string, unknown>).delta) : undefined}
              trend={
                (k as Record<string, unknown>).trend === "up" || (k as Record<string, unknown>).trend === "down"
                  ? ((k as Record<string, unknown>).trend as "up" | "down")
                  : undefined
              }
              hint={typeof (k as Record<string, unknown>).hint === "string" ? String((k as Record<string, unknown>).hint) : undefined}
            />
          ))}
        </div>

        {secondaryKpis.length > 0 ? (
          <Panel title="Coverage" description="Mix and catalog at a glance" bodyClassName="pt-2">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {secondaryKpis.map((k, i) => (
                <StatCard
                  key={`sec-${k.label}-${i}`}
                  label={k.label}
                  value={k.value}
                  delta={typeof (k as Record<string, unknown>).delta === "string" ? String((k as Record<string, unknown>).delta) : undefined}
                  trend={
                    (k as Record<string, unknown>).trend === "up" || (k as Record<string, unknown>).trend === "down"
                      ? ((k as Record<string, unknown>).trend as "up" | "down")
                      : undefined
                  }
                  hint={typeof (k as Record<string, unknown>).hint === "string" ? String((k as Record<string, unknown>).hint) : undefined}
                />
              ))}
            </div>
          </Panel>
        ) : null}

        {isAdmin ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {(spendQuery.isLoading
                ? Array.from({ length: 4 }, () => ({
                    label: "…",
                    value: "—",
                    hint: undefined,
                    delta: undefined,
                    trend: undefined,
                  }))
                : spendQuery.data?.kpis ?? []
              ).map((k, i) => (
                <StatCard
                  key={`spend-${k.label}-${i}`}
                  label={k.label}
                  value={k.value}
                  delta={k.delta}
                  trend={k.trend}
                  hint={k.hint}
                />
              ))}
            </div>
            <Panel
              title={`API spend — ${spendQuery.data?.monthLabel ?? "this month"}`}
              description="Billed OpenAI tokens and WhatsApp outbound × rate card (not Inbox volume)."
              bodyClassName="p-0"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={!spendQuery.data || spendQuery.data.missingTables}
                  onClick={() => {
                    const snap = spendQuery.data;
                    if (!snap) return;
                    downloadCsv(
                      `enertech-api-spend-${new Date().toISOString().slice(0, 10)}.csv`,
                      snap.csvRows,
                    );
                    toast.success("Spend CSV downloaded");
                  }}
                >
                  <Download className="size-4" /> Export CSV
                </Button>
              }
            >
              {spendQuery.isError ? (
                <div className="p-4">
                  <EmptyState
                    title="Could not load API spend"
                    description={describeLoadError(spendQuery.error, "API spend", "037_api_spend.sql")}
                    action={
                      <Button
                        size="sm"
                        onClick={() => queryClient.invalidateQueries({ queryKey: ["dashboard-spend", orgId] })}
                      >
                        Retry
                      </Button>
                    }
                  />
                </div>
              ) : spendQuery.data?.missingTables ? (
                <div className="p-4">
                  <EmptyState
                    title="Usage tracking not enabled"
                    description={featureNotSetUp("Usage tracking", "037_api_spend.sql")}
                  />
                </div>
              ) : spendQuery.isLoading ? (
                <div className="p-4 text-sm text-muted-foreground">Loading spend…</div>
              ) : (spendQuery.data?.rows.length ?? 0) === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title="No spend logged this month"
                    description="Totals start after OpenAI calls and WhatsApp sends are recorded. Earlier months cannot be backfilled from chat volume."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        {["Date (IST)", "Vendor", "Units", "Estimated ₹", "USD"].map((h) => (
                          <th key={h} className="px-4 py-2.5 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {spendQuery.data!.rows.map((r) => (
                        <tr key={`${r.date}-${r.vendor}`} className="hover:bg-secondary/40">
                          <td className="px-4 py-3 font-medium">{r.date}</td>
                          <td className="px-4 py-3">{r.vendor}</td>
                          <td className="num px-4 py-3">{r.units}</td>
                          <td className="num px-4 py-3">{r.inrLabel}</td>
                          <td className="num px-4 py-3 text-muted-foreground">{r.usdLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            title="Conversation Trend"
            description="Messages activity by day (AI vs human/escalated)"
            className="lg:col-span-2"
          >
            {loading ? (
              <div className="grid h-[260px] place-items-center text-sm text-muted-foreground">Loading chart…</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data?.conversationTrend ?? []}>
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
                  <YAxis {...axis} width={38} allowDecimals={false} />
                  <RTooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="ai" stroke="var(--color-chart-1)" strokeWidth={2} fill="url(#gAi)" />
                  <Area type="monotone" dataKey="human" stroke="var(--color-chart-2)" strokeWidth={2} fill="url(#gHuman)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Channel Distribution" description="Share of recent conversations by channel">
            {loading ? (
              <div className="grid h-[200px] place-items-center text-sm text-muted-foreground">Loading…</div>
            ) : (data?.totals.conversations ?? 0) === 0 ? (
              <EmptyState title="No conversations yet" description="Website chat activity will appear here." />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={data?.channelSplit ?? []}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={80}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {(data?.channelSplit ?? []).map((c) => (
                        <Cell key={c.key} fill={getChannelBrand(c.key).accent} />
                      ))}
                    </Pie>
                    <RTooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="mt-2 space-y-1.5">
                  {(data?.channelSplit ?? []).map((c) => (
                    <li key={c.key} className="flex items-center gap-2 text-xs">
                      <span className="size-2 rounded-full" style={{ background: getChannelBrand(c.key).accent }} />
                      <span className="text-muted-foreground">{c.name}</span>
                      <span className="num ml-auto font-medium tabular-nums">
                        {c.count} · {c.value}%
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(loading ? Array.from({ length: 4 }, (_, i) => ({ label: "…", value: "—" })) : data?.salesKpis ?? []).map((k, i) => (
            <StatCard
              key={`${k.label}-${i}`}
              label={k.label}
              value={k.value}
              delta={typeof (k as Record<string, unknown>).delta === "string" ? String((k as Record<string, unknown>).delta) : undefined}
              trend={
                (k as Record<string, unknown>).trend === "up" || (k as Record<string, unknown>).trend === "down"
                  ? ((k as Record<string, unknown>).trend as "up" | "down")
                  : undefined
              }
              hint={typeof (k as Record<string, unknown>).hint === "string" ? String((k as Record<string, unknown>).hint) : undefined}
            />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Lead Funnel" description="Leads by pipeline stage">
            {loading ? (
              <div className="grid h-[240px] place-items-center text-sm text-muted-foreground">Loading…</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data?.leadFunnel ?? []} layout="vertical" margin={{ left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" {...axis} allowDecimals={false} />
                  <YAxis type="category" dataKey="stage" {...axis} width={88} />
                  <RTooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-secondary)" }} />
                  <Bar dataKey="value" fill="var(--color-chart-1)" radius={[0, 6, 6, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Leads by Source" description="Lead count per acquisition channel">
            {loading ? (
              <div className="grid h-[240px] place-items-center text-sm text-muted-foreground">Loading…</div>
            ) : (data?.leadsBySource.length ?? 0) === 0 ? (
              <EmptyState title="No leads yet" description="Sources appear once leads are captured." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={data?.leadsBySource ?? []}
                  margin={{ left: 4, right: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="source"
                    {...axis}
                    interval={0}
                    angle={-28}
                    textAnchor="end"
                    height={56}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis {...axis} width={36} allowDecimals={false} />
                  <RTooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-secondary)" }} />
                  <Bar dataKey="value" name="Leads" fill="var(--color-chart-3)" radius={[6, 6, 0, 0]} barSize={28}>
                    {(data?.leadsBySource ?? []).map((row, i) => (
                      <Cell key={row.key} fill={`var(--color-chart-${(i % 5) + 1})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Sales Pipeline" description="Open deals by stage (includes Lost)">
            {loading ? (
              <div className="grid h-[240px] place-items-center text-sm text-muted-foreground">Loading…</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data?.pipelineByStage ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="stage" {...axis} />
                  <YAxis {...axis} width={38} allowDecimals={false} />
                  <RTooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-secondary)" }} />
                  <Bar dataKey="value" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} barSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
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
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : (data?.recentConversations.length ?? 0) === 0 ? (
              <div className="p-4">
                <EmptyState title="No conversations" description="Start a Website chat to see activity here." />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data!.recentConversations.map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/inbox"
                      search={{ c: c.id }}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/50"
                    >
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
                      <span className="num w-14 shrink-0 text-right text-xs text-muted-foreground">{c.time}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Recent Activity" bodyClassName="p-0">
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : (data?.activity.length ?? 0) === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No recent activity yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {data!.activity.map((a) => (
                  <li key={a.id} className="px-4 py-3">
                    <p className="text-sm">
                      <span className="font-medium">{a.who}</span>{" "}
                      <span className="text-muted-foreground">{a.what}</span>
                    </p>
                    <p className="num mt-0.5 text-[11px] text-muted-foreground">{a.when}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            title="Top Products"
            description="Active catalog by AI weight"
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link to="/products">Catalog</Link>
              </Button>
            }
            bodyClassName="p-0"
          >
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : (data?.recentProducts.length ?? 0) === 0 ? (
              <div className="p-4">
                <EmptyState title="No products" description="Add products in the catalog." />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data!.recentProducts.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-secondary text-[10px] font-semibold">
                      {p.sku.slice(0, 3)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.category}</p>
                    </div>
                    <span className="num text-sm">{p.price}</span>
                  </li>
                ))}
              </ul>
            )}
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
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : (data?.recentLeads.length ?? 0) === 0 ? (
              <div className="p-4">
                <EmptyState title="No leads" description="Create a deal in Pipeline or capture from chat." />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data!.recentLeads.map((l) => (
                  <li key={l.id}>
                    <Link to="/leads" className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/50">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{l.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {l.company} · {l.product}
                        </p>
                      </div>
                      <span className="num text-sm">{l.value}</span>
                      <Pill tone={l.score >= 80 ? "success" : l.score >= 60 ? "warning" : "neutral"}>{l.score}</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
