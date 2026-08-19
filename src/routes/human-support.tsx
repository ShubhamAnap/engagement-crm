import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, Check, RefreshCw, SlidersHorizontal, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChannelIcon,
  EmptyState,
  ListSkeleton,
  PageHeader,
  Panel,
  Pill,
  StatCard,
  Toolbar,
} from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import {
  claimConversation,
  ENERTECH_ORG_ID,
  listHandoffQueue,
  resolveConversation,
  returnConversationToAi,
  transferConversation,
  type HandoffItem,
  type HandoffState,
} from "@/lib/chat-api";
import { listOrgSalesPeople } from "@/lib/leads-api";
import type { ChannelType } from "@/lib/db-types";
import { getBrowserSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { getChannelBrand } from "@/lib/channel-brand";

export const Route = createFileRoute("/human-support")({
  head: () => ({
    meta: [
      { title: "Human Support" },
      {
        name: "description",
        content: "Waiting escalation desk — claim, transfer, resolve, or return threads to EnerBot.",
      },
      { property: "og:title", content: "Human Support" },
    ],
  }),
  component: Page,
});

const stateFilters: Array<"All" | HandoffState> = [
  "All",
  "Waiting",
  "Assigned",
  "Needs reply",
  "Resolved",
];

type DeskTab = "active" | "unassigned" | "mine" | "team" | "resolved";
type SortKey = "waiting_desc" | "updated_desc" | "priority_desc" | "customer_asc";

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: "waiting_desc", label: "Longest waiting" },
  { key: "updated_desc", label: "Newest activity" },
  { key: "priority_desc", label: "Priority (High first)" },
  { key: "customer_asc", label: "Customer A–Z" },
];

function stateTone(state: HandoffState): "success" | "warning" | "info" | "neutral" | "danger" {
  if (state === "Resolved") return "success";
  if (state === "Waiting") return "warning";
  if (state === "Needs reply") return "danger";
  return "neutral";
}

function slaTone(sla: HandoffItem["sla"]): "success" | "warning" | "danger" | "neutral" {
  if (sla === "critical") return "danger";
  if (sla === "warn") return "warning";
  return "neutral";
}

function priorityRank(p: string): number {
  if (p === "High") return 3;
  if (p === "Medium") return 2;
  return 1;
}

function customerName(item: HandoffItem): string {
  return item.customer?.name || item.visitor_name || "Visitor";
}

function Page() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id ?? ENERTECH_ORG_ID;
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"All" | HandoffState>("All");
  const [priorityFilter, setPriorityFilter] = useState<"All" | "High" | "Medium" | "Low">("All");
  const [sortKey, setSortKey] = useState<SortKey>("waiting_desc");
  const [deskTab, setDeskTab] = useState<DeskTab>("active");

  const queueQuery = useQuery({
    queryKey: ["handoff-queue", orgId],
    queryFn: () => listHandoffQueue(orgId),
    refetchInterval: 5000,
  });

  const agentsQuery = useQuery({
    queryKey: ["org-agents", orgId],
    queryFn: () => listOrgSalesPeople(orgId),
    staleTime: 60_000,
  });

  // Realtime: refresh queue when conversations change
  useEffect(() => {
    if (!orgId) return;
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel(`human-support-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `org_id=eq.${orgId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["handoff-queue", orgId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);

  const items = queueQuery.data ?? [];
  const myId = profile?.id || null;

  const waiting = items.filter((i) => i.handoffState === "Waiting");
  const assigned = items.filter((i) => i.handoffState === "Assigned");
  const needsReply = items.filter((i) => i.handoffState === "Needs reply");
  const resolvedToday = items.filter((i) => i.handoffState === "Resolved");
  const longestWait = [...waiting].sort((a, b) => b.waitingMinutes - a.waitingMinutes)[0];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((item) => {
      if (deskTab === "active" && item.handoffState === "Resolved") return false;
      if (deskTab === "unassigned" && item.handoffState !== "Waiting") return false;
      if (deskTab === "mine") {
        if (!myId || item.assignee_id !== myId || item.handoffState === "Resolved") return false;
      }
      if (deskTab === "team") {
        if (!item.assignee_id || item.assignee_id === myId || item.handoffState === "Resolved") {
          return false;
        }
      }
      if (deskTab === "resolved" && item.handoffState !== "Resolved") return false;

      if (stateFilter !== "All" && item.handoffState !== stateFilter) return false;
      if (priorityFilter !== "All" && item.priority !== priorityFilter) return false;
      if (!q) return true;
      const hay = [
        item.external_ref,
        item.visitor_name,
        item.visitor_company,
        item.customer?.name,
        item.customer?.company,
        item.reason,
        item.assignee_label,
        item.preview,
        item.channel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    return [...list].sort((a, b) => {
      if (sortKey === "waiting_desc") {
        return b.waitingMinutes - a.waitingMinutes;
      }
      if (sortKey === "priority_desc") {
        const diff = priorityRank(b.priority) - priorityRank(a.priority);
        if (diff !== 0) return diff;
        return b.waitingMinutes - a.waitingMinutes;
      }
      if (sortKey === "customer_asc") {
        return customerName(a).localeCompare(customerName(b));
      }
      const at = new Date(a.updated_at || a.last_message_at || a.created_at).getTime();
      const bt = new Date(b.updated_at || b.last_message_at || b.created_at).getTime();
      return bt - at;
    });
  }, [items, search, stateFilter, priorityFilter, sortKey, deskTab, myId]);

  const activeSortLabel = sortOptions.find((o) => o.key === sortKey)?.label ?? "Sort";
  const filterActive = stateFilter !== "All" || priorityFilter !== "All";

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["handoff-queue", orgId] }),
      queryClient.invalidateQueries({ queryKey: ["conversations", orgId] }),
      queryClient.invalidateQueries({ queryKey: ["waiting-handoffs", orgId] }),
    ]);
  };

  const claimMutation = useMutation({
    mutationFn: async (item: HandoffItem) => {
      if (!profile?.id) throw new Error("Sign in to take over");
      if (
        item.assignee_id &&
        item.assignee_id !== profile.id &&
        !window.confirm(
          `Already assigned to ${item.assignee_label || "another agent"}. Take over anyway?`,
        )
      ) {
        throw new Error("Take over cancelled");
      }
      const label = profile.fullName || profile.email || "Human agent";
      await claimConversation({
        conversationId: item.id,
        profileId: profile.id,
        assigneeLabel: label,
      });
      return item;
    },
    onSuccess: async (item) => {
      await invalidate();
      toast.success(`Took over ${item.external_ref || item.id.slice(0, 8)}`);
      void navigate({ to: "/inbox", search: { c: item.id } });
    },
    onError: (error) => {
      if (error instanceof Error && error.message === "Take over cancelled") return;
      toast.error(error instanceof Error ? error.message : "Take over failed");
    },
  });

  const transferMutation = useMutation({
    mutationFn: async (payload: { item: HandoffItem; agentId: string; agentName: string }) => {
      await transferConversation({
        conversationId: payload.item.id,
        profileId: payload.agentId,
        assigneeLabel: payload.agentName,
      });
      return payload;
    },
    onSuccess: async (payload) => {
      await invalidate();
      toast.success(
        `Transferred ${payload.item.external_ref || payload.item.id.slice(0, 8)} to ${payload.agentName}`,
      );
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Transfer failed"),
  });

  const resolveMutation = useMutation({
    mutationFn: async (item: HandoffItem) => {
      await resolveConversation(item.id);
      return item;
    },
    onSuccess: async (item) => {
      await invalidate();
      toast.success(`Resolved ${item.external_ref || item.id.slice(0, 8)}`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Resolve failed"),
  });

  const returnMutation = useMutation({
    mutationFn: async (item: HandoffItem) => {
      const { resumed } = await returnConversationToAi(item.id);
      return { item, resumed };
    },
    onSuccess: async ({ item, resumed }) => {
      await invalidate();
      toast.success(
        resumed
          ? `Returned ${item.external_ref || item.id.slice(0, 8)} to EnerBot — replied to waiting message`
          : `Returned ${item.external_ref || item.id.slice(0, 8)} to EnerBot`,
      );
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Return to AI failed"),
  });

  const busyId =
    (claimMutation.isPending && claimMutation.variables?.id) ||
    (resolveMutation.isPending && resolveMutation.variables?.id) ||
    (returnMutation.isPending && returnMutation.variables?.id) ||
    (transferMutation.isPending && transferMutation.variables?.item.id) ||
    null;

  const tabs: Array<{ id: DeskTab; label: string; count: number }> = [
    {
      id: "active",
      label: "Active",
      count: waiting.length + assigned.length + needsReply.length,
    },
    { id: "unassigned", label: "Unassigned", count: waiting.length },
    {
      id: "mine",
      label: "Mine",
      count: items.filter((i) => i.assignee_id === myId && i.handoffState !== "Resolved").length,
    },
    {
      id: "team",
      label: "Team",
      count: items.filter(
        (i) => i.assignee_id && i.assignee_id !== myId && i.handoffState !== "Resolved",
      ).length,
    },
    { id: "resolved", label: "Resolved today", count: resolvedToday.length },
  ];

  return (
    <>
      <PageHeader
        title="Human Support"
        meta={
          <Pill tone={waiting.length > 0 ? "warning" : "success"} dot>
            {waiting.length > 0 ? `${waiting.length} waiting` : "Queue clear"}
          </Pill>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={queueQuery.isFetching}
              onClick={async () => {
                await invalidate();
                toast.success("Queue refreshed");
              }}
            >
              <RefreshCw className={`size-3.5 ${queueQuery.isFetching ? "animate-spin" : ""}`} />
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
            label="Waiting"
            value={String(waiting.length)}
            hint={longestWait ? `longest ${longestWait.waitingLabel}` : "no open waits"}
          />
          <StatCard
            label="Assigned"
            value={String(assigned.length)}
            hint="claimed, no unread"
          />
          <StatCard
            label="Needs reply"
            value={String(needsReply.length)}
            hint="customer unread on claimed threads"
          />
          <StatCard
            label="Resolved today"
            value={String(resolvedToday.length)}
            hint="closed from this desk today"
            trend={resolvedToday.length > 0 ? "up" : undefined}
            delta={resolvedToday.length > 0 ? String(resolvedToday.length) : undefined}
          />
        </div>

        <Panel
          title="Handoff desk"
          description="True escalations only — marketplace follow-ups stay in Inbox / Leads"
          bodyClassName="p-0"
        >
          <div className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setDeskTab(t.id)}
                className={cn(
                  "shrink-0 rounded-md border px-3 py-1.5 text-xs touch-manipulation",
                  deskTab === t.id
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                )}
              >
                {t.label}
                <span className="num ml-1.5 opacity-70">{t.count}</span>
              </button>
            ))}
          </div>

          <Toolbar
            placeholder="Search customer, channel, reason…"
            value={search}
            onChange={setSearch}
            filter={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`h-9 gap-1.5 ${filterActive ? "border-primary text-primary" : ""}`}
                  >
                    <SlidersHorizontal className="size-4" />
                    Filter
                    {filterActive ? (
                      <span className="num rounded bg-primary/10 px-1.5 text-[10px]">on</span>
                    ) : null}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>State</DropdownMenuLabel>
                  {stateFilters.map((f) => (
                    <DropdownMenuItem key={f} onClick={() => setStateFilter(f)}>
                      <span className="flex-1">{f}</span>
                      {stateFilter === f ? <Check className="size-4" /> : null}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Priority</DropdownMenuLabel>
                  {(["All", "High", "Medium", "Low"] as const).map((p) => (
                    <DropdownMenuItem key={p} onClick={() => setPriorityFilter(p)}>
                      <span className="flex-1">{p}</span>
                      {priorityFilter === p ? <Check className="size-4" /> : null}
                    </DropdownMenuItem>
                  ))}
                  {filterActive ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          setStateFilter("All");
                          setPriorityFilter("All");
                        }}
                      >
                        Clear filters
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            }
            sort={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-1.5">
                    <ArrowUpDown className="size-4" />
                    Sort
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>{activeSortLabel}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {sortOptions.map((o) => (
                    <DropdownMenuItem key={o.key} onClick={() => setSortKey(o.key)}>
                      <span className="flex-1">{o.label}</span>
                      {sortKey === o.key ? <Check className="size-4" /> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />

          {queueQuery.isLoading ? (
            <div className="p-3">
              <ListSkeleton rows={6} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={search || filterActive || deskTab !== "active" ? "No matching handoffs" : "Queue is clear"}
                description={
                  search || filterActive || deskTab !== "active"
                    ? "Try another tab, filter, or search."
                    : "When a visitor asks for a human (or a service ticket is ready), threads appear here."
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {[
                      "ID",
                      "Customer",
                      "Channel",
                      "Preview",
                      "Reason",
                      "Priority",
                      "Wait / SLA",
                      "State",
                      "Agent",
                      "Actions",
                    ].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((q) => {
                    const customer = customerName(q);
                    const company = q.customer?.company || q.visitor_company || "—";
                    const ref = q.external_ref || q.id.slice(0, 8);
                    const agent =
                      q.handoffState === "Waiting"
                        ? "—"
                        : q.assignee_label && q.assignee_label !== "Human queue"
                          ? q.assignee_label
                          : "—";
                    const rowBusy = busyId === q.id;
                    const isMine = Boolean(myId && q.assignee_id === myId);
                    return (
                      <tr
                        key={q.id}
                        className={cn(
                          "hover:bg-secondary/40",
                          q.handoffState === "Waiting" && "bg-warning/5",
                        )}
                        style={{
                          boxShadow: `inset 3px 0 0 ${
                            q.handoffState === "Waiting"
                              ? "var(--color-warning)"
                              : getChannelBrand(q.channel).accent
                          }`,
                        }}
                      >
                        <td className="num px-4 py-3 whitespace-nowrap">{ref}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium whitespace-nowrap">{customer}</p>
                          <p className="text-xs text-muted-foreground whitespace-nowrap">{company}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <ChannelIcon
                              channel={(q.channel as ChannelType) || "website"}
                              className="size-3.5 text-muted-foreground"
                            />
                            <span className="capitalize text-xs">{q.channel || "—"}</span>
                          </div>
                        </td>
                        <td className="max-w-[180px] px-4 py-3 text-muted-foreground">
                          <span className="line-clamp-2 text-xs">{q.preview || "—"}</span>
                        </td>
                        <td className="max-w-[200px] px-4 py-3 text-muted-foreground">
                          <span className="line-clamp-2">{q.reason}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Pill
                            tone={
                              q.priority === "High"
                                ? "danger"
                                : q.priority === "Medium"
                                  ? "warning"
                                  : "neutral"
                            }
                          >
                            {q.priority}
                          </Pill>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <span className="num">{q.waitingLabel || "—"}</span>
                            {q.handoffState !== "Resolved" ? (
                              <Pill tone={slaTone(q.sla)} className="w-fit text-[10px]">
                                {q.sla === "critical"
                                  ? "SLA >1h"
                                  : q.sla === "warn"
                                    ? "SLA >15m"
                                    : "On track"}
                              </Pill>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Pill tone={stateTone(q.handoffState)} dot>
                            {q.handoffState}
                          </Pill>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{agent}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {q.handoffState === "Waiting" ? (
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                disabled={rowBusy}
                                onClick={() => claimMutation.mutate(q)}
                              >
                                Take over
                              </Button>
                            ) : q.handoffState !== "Resolved" ? (
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => navigate({ to: "/inbox", search: { c: q.id } })}
                              >
                                Open
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => navigate({ to: "/inbox", search: { c: q.id } })}
                              >
                                Open
                              </Button>
                            )}
                            {q.handoffState === "Waiting" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => navigate({ to: "/inbox", search: { c: q.id } })}
                              >
                                Open
                              </Button>
                            ) : null}
                            {q.handoffState !== "Resolved" ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1 text-xs"
                                    disabled={rowBusy || agentsQuery.isLoading}
                                  >
                                    <UserRound className="size-3" />
                                    Transfer
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="max-h-64 w-56 overflow-y-auto">
                                  <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  {(agentsQuery.data ?? [])
                                    .filter((a) => a.id !== q.assignee_id)
                                    .map((a) => (
                                      <DropdownMenuItem
                                        key={a.id}
                                        onClick={() =>
                                          transferMutation.mutate({
                                            item: q,
                                            agentId: a.id,
                                            agentName: a.name,
                                          })
                                        }
                                      >
                                        {a.name}
                                        {a.id === myId ? " (me)" : ""}
                                      </DropdownMenuItem>
                                    ))}
                                  {(agentsQuery.data ?? []).length === 0 ? (
                                    <DropdownMenuItem disabled>No agents found</DropdownMenuItem>
                                  ) : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : null}
                            {q.handoffState !== "Resolved" && (isMine || q.handoffState === "Waiting") ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={rowBusy}
                                onClick={() => resolveMutation.mutate(q)}
                              >
                                Resolve
                              </Button>
                            ) : null}
                            {q.handoffState !== "Resolved" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                disabled={rowBusy}
                                onClick={() => returnMutation.mutate(q)}
                              >
                                Return to AI
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                Showing {filtered.length} handoff{filtered.length === 1 ? "" : "s"}
              </p>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
