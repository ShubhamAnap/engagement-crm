import { useEffect, useState } from "react";
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
import { useAuth } from "@/lib/auth";
import { ENERTECH_ORG_ID } from "@/lib/chat-api";
import {
  getAiAnswerStats,
  listRecentAiAnswers,
  type AiAnswerRow,
} from "@/lib/ai-chat-api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ai-chat")({
  head: () => ({
    meta: [
      { title: "AI Chat Support — EnerTech Engage" },
      {
        name: "description",
        content: "Inspect what the AI retrieved, remembered and reasoned before every answer it sent.",
      },
      { property: "og:title", content: "AI Chat Support — EnerTech Engage" },
    ],
  }),
  component: Page,
});

function Page() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id ?? ENERTECH_ORG_ID;
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const answers = answersQuery.data ?? [];
  const selected: AiAnswerRow | null =
    answers.find((a) => a.message.id === selectedId) ?? answers[0] ?? null;

  useEffect(() => {
    if (!selectedId && answers[0]) setSelectedId(answers[0].message.id);
  }, [answers, selectedId]);

  const stats = statsQuery.data;

  return (
    <>
      <PageHeader
        title="AI Chat Support"
        description="Inspect what the AI retrieved, remembered and reasoned before every answer it sent."
        meta={
          <Pill tone="neutral" dot>
            Live answers from Supabase
          </Pill>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={answersQuery.isFetching}
              onClick={async () => {
                await queryClient.invalidateQueries({ queryKey: ["ai-answers", orgId] });
                await queryClient.invalidateQueries({ queryKey: ["ai-answer-stats", orgId] });
                toast.success("Refreshed");
              }}
            >
              <RefreshCw className={`size-3.5 ${answersQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => navigate({ to: "/inbox" })}>
              Open inbox
            </Button>
          </div>
        }
      />
      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Answers Today"
            value={String(stats?.answersToday ?? "—")}
            hint="AI replies since midnight"
            icon={Brain}
          />
          <StatCard
            label="Grounded Answers"
            value={stats ? `${stats.groundedPct}%` : "—"}
            hint="with knowledge sources"
            icon={BookOpen}
          />
          <StatCard
            label="Hallucination Flags"
            value={String(stats?.hallucinationFlags ?? "—")}
            hint="high risk replies today"
            icon={AlertTriangle}
          />
          <StatCard
            label="Inspected Sample"
            value={String(stats?.sampleSize ?? "—")}
            hint="recent AI messages"
            icon={Target}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Panel title="Recent AI answers" bodyClassName="p-0">
            {answersQuery.isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : answers.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No AI answers yet"
                  description="Send a message via website chat or a channel — replies appear here with inspector data."
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
                <p className="whitespace-pre-wrap rounded-lg bg-secondary p-3 text-sm">
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
                    <p className="num text-lg font-semibold">{selected.hallucinationRisk}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs uppercase text-muted-foreground">Retrieved documents</p>
                {selected.sources.length === 0 ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    No knowledge sources attached to this reply.
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5 text-sm">
                    {selected.sources.map((s) => (
                      <li
                        key={`${s.title}-${s.score}`}
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
                    </div>
                  </Panel>
                  <Panel title="Suggested next action">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          navigate({ to: "/command-center" })
                        }
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
              <EmptyState title="Select an answer" description="Pick a recent AI reply to inspect." />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
