import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, Brain, RefreshCw, Target } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ChannelIcon,
  EmptyState,
  PageHeader,
  Panel,
  Pill,
  StatCard,
} from "@/components/shared/ui-kit";
import { useAuth, useOrgId } from "@/lib/auth";
import {
  getAiAnswerStats,
  listRecentAiAnswers,
  type AiAnswerRow,
} from "@/lib/ai-chat-api";
import type { ChannelType } from "@/lib/db-types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ai-chat")({
  head: () => ({
    meta: [
      { title: "AI Chat Support" },
      {
        name: "description",
        content: "Inspect what the AI retrieved, remembered and reasoned before every answer it sent.",
      },
      { property: "og:title", content: "AI Chat Support" },
    ],
  }),
  component: Page,
});

const CHANNEL_FILTERS: Array<{ label: string; value: "all" | ChannelType }> = [
  { label: "All", value: "all" },
  { label: "Website", value: "website" },
  { label: "WhatsApp", value: "whatsapp" },
  { label: "Email", value: "email" },
  { label: "IndiaMART", value: "indiamart" },
  { label: "TradeIndia", value: "tradeindia" },
  { label: "Instagram", value: "instagram" },
  { label: "Facebook", value: "facebook" },
];

function Page() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = useOrgId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<"all" | ChannelType>("all");
  const [highRiskOnly, setHighRiskOnly] = useState(false);

  const answersQuery = useQuery({
    queryKey: ["ai-answers", orgId],
    queryFn: () => listRecentAiAnswers(orgId, 50),
    refetchInterval: 8_000,
  });

  const statsQuery = useQuery({
    queryKey: ["ai-answer-stats", orgId],
    queryFn: () => getAiAnswerStats(orgId),
    refetchInterval: 8_000,
  });

  const answers = useMemo(() => {
    let rows = answersQuery.data ?? [];
    if (channelFilter !== "all") {
      rows = rows.filter((a) => a.channel === channelFilter);
    }
    if (highRiskOnly) {
      rows = rows.filter((a) => a.hallucinationRisk === "High");
    }
    return rows;
  }, [answersQuery.data, channelFilter, highRiskOnly]);

  const selected: AiAnswerRow | null = useMemo(() => {
    if (!answers.length) return null;
    return answers.find((a) => a.message.id === selectedId) ?? answers[0] ?? null;
  }, [answers, selectedId]);

  useEffect(() => {
    if (!answers.length) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!selectedId || !answers.some((a) => a.message.id === selectedId)) {
      setSelectedId(answers[0].message.id);
    }
  }, [answers, selectedId]);

  const stats = statsQuery.data;
  const loading = answersQuery.isLoading || statsQuery.isLoading;
  const hasError = answersQuery.isError || statsQuery.isError;
  const errorMessage =
    (answersQuery.error instanceof Error && answersQuery.error.message) ||
    (statsQuery.error instanceof Error && statsQuery.error.message) ||
    "Could not load AI answers.";

  async function onRefresh() {
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ai-answers", orgId] }),
        queryClient.invalidateQueries({ queryKey: ["ai-answer-stats", orgId] }),
      ]);
      await Promise.all([answersQuery.refetch(), statsQuery.refetch()]);
      toast.success("Refreshed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    }
  }

  return (
    <>
      <PageHeader
        title="AI Chat Support"
        description="Inspect what the AI retrieved, remembered and reasoned before every answer it sent."
        meta={
          <Pill tone={hasError ? "danger" : "neutral"} dot>
            {hasError ? "Data error" : "Live answers from Supabase"}
          </Pill>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={answersQuery.isFetching || statsQuery.isFetching}
              onClick={() => void onRefresh()}
            >
              <RefreshCw
                className={`size-3.5 ${answersQuery.isFetching || statsQuery.isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button size="sm" onClick={() => navigate({ to: "/inbox" })}>
              Open inbox
            </Button>
          </div>
        }
      />
      <div className="space-y-4 p-6">
        {hasError ? (
          <EmptyState
            title="Could not load AI Chat Support"
            description={errorMessage}
            action={
              <Button size="sm" onClick={() => void onRefresh()}>
                Retry
              </Button>
            }
          />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Answers Today"
            value={loading && !stats ? "—" : String(stats?.answersToday ?? "—")}
            hint="AI replies since midnight"
            icon={Brain}
          />
          <StatCard
            label="Grounded Answers"
            value={loading && !stats ? "—" : stats ? `${stats.groundedPct}%` : "—"}
            hint="with knowledge sources (today)"
            icon={BookOpen}
          />
          <StatCard
            label="Hallucination Flags"
            value={loading && !stats ? "—" : String(stats?.hallucinationFlags ?? "—")}
            hint="high risk replies today"
            icon={AlertTriangle}
          />
          <StatCard
            label="Inspected Sample"
            value={loading && !stats ? "—" : String(stats?.sampleSize ?? "—")}
            hint="recent AI messages loaded"
            icon={Target}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Panel title="Recent AI answers" bodyClassName="p-0">
            <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
              {CHANNEL_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setChannelFilter(f.value)}
                  className={cn(
                    "shrink-0 rounded-md border px-2.5 py-1 text-[11px]",
                    channelFilter === f.value
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setHighRiskOnly((v) => !v)}
                className={cn(
                  "shrink-0 rounded-md border px-2.5 py-1 text-[11px]",
                  highRiskOnly
                    ? "border-destructive/50 bg-destructive/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-destructive/40 hover:text-foreground",
                )}
              >
                High risk
              </button>
            </div>
            {answersQuery.isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : answers.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title={
                    (answersQuery.data?.length ?? 0) === 0
                      ? "No AI answers yet"
                      : "No matches for this filter"
                  }
                  description={
                    (answersQuery.data?.length ?? 0) === 0
                      ? "Send a message via website chat or a channel — replies appear here with inspector data."
                      : "Try All channels or clear the High risk filter."
                  }
                />
              </div>
            ) : (
              <ul className="max-h-[720px] divide-y divide-border overflow-y-auto">
                {answers.map((a) => (
                  <li key={a.message.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full gap-3 px-4 py-3 text-left hover:bg-secondary/40",
                        selected?.message.id === a.message.id && "bg-secondary/60",
                      )}
                      onClick={() => setSelectedId(a.message.id)}
                    >
                      <ChannelIcon channel={a.channel} className="mt-0.5 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">{a.customer}</p>
                          <span className="num shrink-0 text-[11px] text-muted-foreground">
                            {a.whenLabel}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {a.externalRef} · {a.agentLabel}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.preview}</p>
                        {a.hallucinationRisk === "High" ? (
                          <Pill tone="danger" className="mt-1.5">
                            High risk
                          </Pill>
                        ) : null}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {selected ? (
            <div className="space-y-4">
              <Panel
                title="Answer Inspector"
                description={`${selected.externalRef} · ${selected.customer}`}
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate({ to: "/inbox", search: { c: selected.conversationId } })
                    }
                  >
                    Open thread
                  </Button>
                }
              >
                {selected.customerQuestion ? (
                  <div className="mb-3 rounded-lg border border-border bg-card p-3">
                    <p className="text-[11px] uppercase text-muted-foreground">Customer asked</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{selected.customerQuestion}</p>
                  </div>
                ) : (
                  <p className="mb-3 text-xs text-muted-foreground">
                    No prior customer message found for this reply.
                  </p>
                )}
                <p className="text-[11px] uppercase text-muted-foreground">AI replied</p>
                <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-secondary p-3 text-sm">
                  {selected.message.body}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-border p-2.5">
                    <p className="text-[11px] uppercase text-muted-foreground">Confidence</p>
                    <p
                      className={cn(
                        "num text-lg font-semibold",
                        selected.confidence >= 0.8
                          ? "text-success"
                          : selected.confidence >= 0.65
                            ? "text-warning"
                            : "text-destructive",
                      )}
                    >
                      {selected.confidence.toFixed(2)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-2.5">
                    <p className="text-[11px] uppercase text-muted-foreground">Hallucination risk</p>
                    <p
                      className={cn(
                        "num text-lg font-semibold",
                        selected.hallucinationRisk === "High"
                          ? "text-destructive"
                          : selected.hallucinationRisk === "Medium"
                            ? "text-warning"
                            : "text-success",
                      )}
                    >
                      {selected.hallucinationRisk}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs uppercase text-muted-foreground">Retrieved documents</p>
                {selected.sources.length === 0 ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    No knowledge sources attached to this reply.
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5 text-sm">
                    {selected.sources.map((s, i) => (
                      <li
                        key={`${s.title}-${s.score}-${i}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                      >
                        <span className="min-w-0 truncate">
                          {s.url ? (
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              {s.title}
                            </a>
                          ) : (
                            s.title
                          )}
                        </span>
                        <Pill tone={s.score >= 0.8 ? "success" : s.score >= 0.6 ? "warning" : "neutral"}>
                          {s.score.toFixed(2)}
                        </Pill>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Reasoning Trace">
                  <ol className="space-y-2 text-sm text-muted-foreground">
                    {selected.reasoning.map((step, i) => (
                      <li key={i}>
                        {i + 1}. {step}
                      </li>
                    ))}
                  </ol>
                </Panel>
                <div className="space-y-4">
                  <Panel title="Memory">
                    <p className="text-sm text-muted-foreground">{selected.memory}</p>
                  </Panel>
                  <Panel title="Model & grounding">
                    <div className="flex flex-wrap gap-2">
                      <Pill tone="neutral">{selected.model}</Pill>
                      <Pill tone={selected.grounded ? "success" : "warning"}>
                        {selected.grounded ? "Grounded" : "Ungrounded"}
                      </Pill>
                      <Pill tone="info">{selected.channel}</Pill>
                      {selected.toolsUsed.length ? (
                        selected.toolsUsed.map((t) => (
                          <Pill key={t} tone="success">
                            Tool: {t}
                          </Pill>
                        ))
                      ) : (
                        <Pill tone="neutral">No tools used</Pill>
                      )}
                    </div>
                  </Panel>
                  <Panel title="Suggested next action">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate({ to: "/command-center" })}
                      >
                        Supervise in Command Center
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          navigate({ to: "/inbox", search: { c: selected.conversationId } })
                        }
                      >
                        Reply in Inbox
                      </Button>
                    </div>
                  </Panel>
                </div>
              </div>
            </div>
          ) : (
            <Panel title="Answer Inspector">
              <EmptyState
                title="Select an answer"
                description={
                  hasError
                    ? "Fix the load error, then pick a recent AI reply."
                    : "Pick a recent AI reply to inspect."
                }
              />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
