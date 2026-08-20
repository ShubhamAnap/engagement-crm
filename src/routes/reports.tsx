import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader, Panel, Pill, StatCard } from "@/components/shared/ui-kit";
import { useAuth, useOrgId } from "@/lib/auth";
import {
  REPORT_CATALOG,
  downloadCsv,
  generateReport,
  type ReportId,
  type ReportRange,
  type ReportResult,
} from "@/lib/reports-api";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports" },
      {
        name: "description",
        content: "Ad-hoc reports across conversations, pipeline, channels, AI quality and automations.",
      },
      { property: "og:title", content: "Reports" },
    ],
  }),
  component: Page,
});

function Page() {
  const { profile } = useAuth();
  const orgId = useOrgId();
  const [rangeDays, setRangeDays] = useState<ReportRange>(30);
  const [selectedId, setSelectedId] = useState<ReportId>("conversations");
  const [lastResult, setLastResult] = useState<ReportResult | null>(null);
  const [search, setSearch] = useState("");

  const selectedDef = REPORT_CATALOG.find((r) => r.id === selectedId)!;

  const catalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return REPORT_CATALOG;
    return REPORT_CATALOG.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q),
    );
  }, [search]);

  const previewQuery = useQuery({
    queryKey: ["report-preview", orgId, selectedId, rangeDays],
    queryFn: () => generateReport(orgId, selectedId, rangeDays),
    staleTime: 30_000,
  });

  const generateMutation = useMutation({
    mutationFn: () => generateReport(orgId, selectedId, rangeDays),
    onSuccess: (result) => {
      setLastResult(result);
      toast.success(`Generated “${result.name}”`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Report failed"),
  });

  const result = lastResult?.id === selectedId && lastResult.rangeDays === rangeDays
    ? lastResult
    : previewQuery.data ?? null;

  function onExport() {
    const data = result;
    if (!data) {
      toast.message("Generate the report first");
      return;
    }
    downloadCsv(data.csvFilename, data.csvContent);
    toast.success("CSV downloaded");
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="Build ad-hoc reports from live Supabase data and export CSV for sharing."
        meta={
          <div className="flex flex-wrap gap-2">
            <Pill tone="neutral">Last {rangeDays} days</Pill>
            {result ? (
              <Pill tone="success" dot>
                Ready
              </Pill>
            ) : (
              <Pill tone="warning" dot>
                Loading
              </Pill>
            )}
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={String(rangeDays)}
              onValueChange={(v) => {
                setRangeDays(Number(v) as ReportRange);
                setLastResult(null);
              }}
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
              disabled={previewQuery.isFetching}
              onClick={() => {
                void previewQuery.refetch();
                toast.success("Report refreshed");
              }}
            >
              <RefreshCw className={`size-3.5 ${previewQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
            >
              <FileSpreadsheet className="size-3.5" />
              {generateMutation.isPending ? "Building…" : "Build report"}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onExport} disabled={!result}>
              <Download className="size-3.5" /> Export CSV
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Panel title="Report catalog" bodyClassName="p-0">
            <div className="border-b border-border px-3 py-2">
              <input
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Search reports…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <ul className="divide-y divide-border">
              {catalog.map((r) => {
                const active = r.id === selectedId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`w-full px-4 py-3 text-left hover:bg-secondary/40 ${
                        active ? "bg-secondary/50" : ""
                      }`}
                      onClick={() => {
                        setSelectedId(r.id);
                        setLastResult(null);
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{r.name}</p>
                        <Pill tone="neutral">{r.format}</Pill>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {r.category}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <div className="space-y-4">
            <Panel
              title={selectedDef.name}
              description={`${selectedDef.description} · Last ${rangeDays} days`}
            >
              {previewQuery.isLoading && !result ? (
                <p className="text-sm text-muted-foreground">Building report from live data…</p>
              ) : previewQuery.isError ? (
                <EmptyState
                  title="Could not build report"
                  description={
                    previewQuery.error instanceof Error
                      ? previewQuery.error.message
                      : "Check Supabase connection and try again."
                  }
                />
              ) : result ? (
                <>
                  <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {result.kpis.map((k) => (
                      <StatCard key={k.label} label={k.label} value={k.value} hint={k.hint} />
                    ))}
                  </div>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Generated {new Date(result.generatedAt).toLocaleString()}
                  </p>
                  <div className="space-y-4">
                    {result.tables.map((table) => (
                      <div key={table.title} className="overflow-x-auto rounded-lg border border-border">
                        <div className="border-b border-border bg-secondary/40 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {table.title}
                        </div>
                        <table className="w-full text-sm">
                          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                              {table.columns.map((h) => (
                                <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {table.rows.length === 0 ? (
                              <tr>
                                <td
                                  className="px-3 py-3 text-muted-foreground"
                                  colSpan={table.columns.length}
                                >
                                  No rows in this range.
                                </td>
                              </tr>
                            ) : (
                              table.rows.map((row, i) => (
                                <tr key={i} className="hover:bg-secondary/30">
                                  {row.map((cell, j) => (
                                    <td key={j} className="whitespace-nowrap px-3 py-2">
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState title="No data" description="Select a report and date range." />
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
