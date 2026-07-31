import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  Hand,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Timer,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  ChannelIcon,
  EmptyState,
  PageHeader,
  Panel,
  Pill,
  StatCard,
} from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import { claimConversation, ENERTECH_ORG_ID } from "@/lib/chat-api";
import {
  getCommandCenterSnapshot,
  getSessionTimeline,
  pauseAllLiveAi,
  pauseSessionAi,
  resumeAllPausedAi,
  resumeSessionAi,
  type LiveSession,
} from "@/lib/command-center-api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/command-center")({
  head: () => ({
    meta: [
      { title: "AI Command Center — EnerTech Engage" },
      {
        name: "description",
        content:
          "Real-time monitoring of live AI conversations: confidence, knowledge sources, memory, latency and escalations.",
      },
      { property: "og:title", content: "AI Command Center — EnerTech Engage" },
    ],
  }),
  component: CommandCenter,
});

function CommandCenter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id ?? ENERTECH_ORG_ID;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [globalPaused, setGlobalPaused] = useState(false);

  const snapshotQuery = useQuery({
    queryKey: ["command-center", orgId],
    queryFn: () => getCommandCenterSnapshot(orgId),
    refetchInterval: 5_000,
  });

  const sessions = snapshotQuery.data?.sessions ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.customer.toLowerCase().includes(q) ||
        s.externalRef.toLowerCase().includes(q) ||
        s.agentLabel.toLowerCase().includes(q) ||
        s.channel.toLowerCase().includes(q) ||
        s.preview.toLowerCase().includes(q),
    );
  }, [sessions, search]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((s) => s.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const session: LiveSession | null = filtered.find((s) => s.id === selectedId) ?? null;

  const timelineQuery = useQuery({
    queryKey: ["command-center-timeline", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => getSessionTimeline(selectedId!),
    refetchInterval: 5_000,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["command-center", orgId] });
    if (selectedId) {
      await queryClient.invalidateQueries({ queryKey: ["command-center-timeline", selectedId] });
    }
  };

  const takeOverMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!profile) throw new Error("Not signed in");
      await claimConversation({
        conversationId: id,
        profileId: profile.id,
        assigneeLabel: profile.full_name || profile.email,
      });
    },
    onSuccess: async (_, id) => {
      toast.success("You took over this session");
      await invalidate();
      await navigate({ to: "/inbox", search: { c: id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Takeover failed"),
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => pauseSessionAi(id),
    onSuccess: async () => {
      toast.success("AI paused for this session");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Pause failed"),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => resumeSessionAi(id),
    onSuccess: async () => {
      toast.success("AI resumed");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Resume failed"),
  });

  const globalPauseMutation = useMutation({
    mutationFn: async () => {
      if (globalPaused) return resumeAllPausedAi(orgId);
      return pauseAllLiveAi(orgId);
    },
    onSuccess: async (count) => {
      setGlobalPaused((p) => !p);
      toast.success(
        globalPaused
          ? `Resumed ${count} paused session${count === 1 ? "" : "s"}`
          : `Paused AI on ${count} live session${count === 1 ? "" : "s"}`,
      );
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Global pause failed"),
  });

  const kpis = snapshotQuery.data?.kpis;

  return (
    <>
      <PageHeader
        title="AI Command Center"
        description="Live supervision of every AI conversation with instant human override."
        meta={
          <>
            <Pill tone="success" dot>
              {kpis?.live ?? 0} live AI
            </Pill>
            {(kpis?.escalations ?? 0) > 0 ? (
              <Pill tone="warning" dot>
                {kpis!.escalations} escalation{kpis!.escalations === 1 ? "" : "s"}
              </Pill>
            ) : (
              <Pill tone="neutral">No escalations</Pill>
            )}
            <Pill tone="neutral">Auto-refresh 5s</Pill>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={snapshotQuery.isFetching}
              onClick={() => void invalidate()}
            >
              <RefreshCw className={`size-4 ${snapshotQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant={globalPaused ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              disabled={globalPauseMutation.isPending}
              onClick={() => globalPauseMutation.mutate()}
            >
              {globalPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
              {globalPaused ? "Resume all AI" : "Pause all AI"}
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Live Sessions"
            value={String(kpis?.live ?? "—")}
            hint={`across ${kpis?.channels ?? 0} channels`}
            icon={Activity}
          />
          <StatCard
            label="Avg. Confidence"
            value={kpis ? kpis.avgConfidence.toFixed(2) : "—"}
            hint="from latest AI replies"
            icon={Zap}
          />
          <StatCard
            label="Avg. Latency"
            value={kpis?.avgLatencyMs ? `${(kpis.avgLatencyMs / 1000).toFixed(2)}s` : "—"}
            hint="customer → AI gap"
            icon={Timer}
          />
          <StatCard
            label="Escalations"
            value={String(kpis?.escalations ?? "—")}
            hint="awaiting takeover"
            icon={ShieldAlert}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <Panel title="Live conversations" bodyClassName="p-0">
            <div className="border-b border-border px-3 py-2">
              <input
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Search live sessions…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {snapshotQuery.isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading live sessions…</p>
            ) : filtered.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No live sessions"
                  description="Open website chat or wait for channel traffic. AI / human / escalated threads appear here."
                />
              </div>
            ) : (
              <ul className="max-h-[640px] divide-y divide-border overflow-y-auto">
                {filtered.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(s.id)}
                      className={cn(
                        "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50",
                        selectedId === s.id && "bg-secondary/70",
                      )}
                    >
                      <ChannelIcon channel={s.channel} className="text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {s.customer}{" "}
                          <span className="num text-xs font-normal text-muted-foreground">
                            · {s.externalRef}
                          </span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {s.agentLabel} · {s.sources} sources · {s.tokensEstimate.toLocaleString()}{" "}
                          tokens · {s.lastActivityLabel}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Pill
                          tone={
                            s.confidence >= 0.8
                              ? "success"
                              : s.confidence >= 0.6
                                ? "warning"
                                : "danger"
                          }
                        >
                          {s.confidence.toFixed(2)}
                        </Pill>
                        <span className="num w-14 text-right text-xs text-muted-foreground">
                          {s.latencyMs ? `${s.latencyMs}ms` : "—"}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="space-y-4">
            {session ? (
              <>
                <Panel
                  title={`Session ${session.externalRef}`}
                  description={`${session.customer}${session.company ? ` · ${session.company}` : ""} · ${session.agentLabel}`}
                  action={
                    <Pill
                      tone={
                        session.escalation === "None"
                          ? "success"
                          : session.escalation === "Triggered"
                            ? "danger"
                            : "warning"
                      }
                      dot
                    >
                      {session.escalation === "None" ? "Healthy" : session.escalation}
                    </Pill>
                  }
                >
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      ["Status", session.status],
                      ["Channel", session.channel],
                      ["Memory", session.memory],
                      ["Knowledge sources", `${session.sources} on last reply`],
                      ["Token estimate", session.tokensEstimate.toLocaleString()],
                      ["Latency", session.latencyMs ? `${session.latencyMs} ms` : "—"],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg border border-border bg-secondary/40 p-2.5">
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {k}
                        </dt>
                        <dd className="mt-0.5 truncate text-sm font-medium">{v}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Confidence score</span>
                      <span className="num font-medium">
                        {(session.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <Progress value={session.confidence * 100} className="h-1.5" />
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{session.preview}</p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={takeOverMutation.isPending}
                      onClick={() => takeOverMutation.mutate(session.id)}
                    >
                      <Hand className="size-4" /> Take over
                    </Button>
                    {session.status === "ai" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={pauseMutation.isPending}
                        onClick={() => pauseMutation.mutate(session.id)}
                      >
                        <Pause className="size-4" /> Pause AI
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={resumeMutation.isPending}
                        onClick={() => resumeMutation.mutate(session.id)}
                      >
                        <Play className="size-4" /> Resume AI
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate({ to: "/inbox", search: { c: session.id } })}
                    >
                      Open in Inbox
                    </Button>
                  </div>
                </Panel>

                <Panel title="Conversation timeline" bodyClassName="p-0">
                  {timelineQuery.isLoading ? (
                    <p className="p-4 text-sm text-muted-foreground">Loading timeline…</p>
                  ) : (timelineQuery.data?.events.length ?? 0) === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No messages yet.</p>
                  ) : (
                    <ol className="relative max-h-[360px] overflow-y-auto px-4 py-3">
                      {(timelineQuery.data?.events ?? []).map((e, i, arr) => (
                        <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                          {i < arr.length - 1 && (
                            <span className="absolute top-4 left-[7px] h-full w-px bg-border" />
                          )}
                          <span
                            className={cn(
                              "z-10 mt-1.5 size-3.5 shrink-0 rounded-full border-2 border-background",
                              e.tone === "success" && "bg-success",
                              e.tone === "warning" && "bg-warning",
                              e.tone === "info" && "bg-info",
                              e.tone === "primary" && "bg-primary",
                              e.tone === "danger" && "bg-destructive",
                              e.tone === "neutral" && "bg-muted-foreground",
                            )}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{e.label}</p>
                            <p className="truncate text-xs text-muted-foreground">{e.detail}</p>
                          </div>
                          <span className="num ml-auto shrink-0 text-[11px] text-muted-foreground">
                            {e.t}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Panel>

                <Panel title="Active agent" bodyClassName="p-4">
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-lg bg-primary/15 text-primary">
                      <Bot className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{session.agentLabel}</p>
                      <p className="text-xs text-muted-foreground">
                        memory {session.memory.toLowerCase()} · {session.messageCount} messages · RAG
                        when knowledge matches
                      </p>
                    </div>
                  </div>
                </Panel>
              </>
            ) : (
              <Panel title="Session detail">
                <EmptyState
                  title="Select a session"
                  description="Pick a live conversation to inspect confidence, timeline, and controls."
                />
              </Panel>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
