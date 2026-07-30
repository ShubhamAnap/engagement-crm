import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, Check, RefreshCw, SlidersHorizontal } from "lucide-react";
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
  EmptyState,
  ListSkeleton,
  PageHeader,
  Panel,
  Pill,
  StatCard,
  TablePagination,
  Toolbar,
} from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import {
  claimConversation,
  ENERTECH_ORG_ID,
  listHandoffQueue,
  resolveConversation,
  returnConversationToAi,
  type HandoffItem,
  type HandoffState,
} from "@/lib/chat-api";

export const Route = createFileRoute("/human-support")({
  head: () => ({
    meta: [
      { title: "Human Support — EnerTech Engage" },
      {
        name: "description",
        content: "Handoff queue with takeover, transfer and resolution controls for the support desk.",
      },
      { property: "og:title", content: "Human Support — EnerTech Engage" },
      {
        property: "og:description",
        content: "Handoff queue with takeover, transfer and resolution controls for the support desk.",
      },
    ],
  }),
  component: Page,
});

const stateFilters: Array<"All" | HandoffState> = ["All", "Waiting", "Assigned", "Working", "Resolved"];

type SortKey = "updated_desc" | "waiting_desc" | "priority_desc" | "customer_asc";

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: "updated_desc", label: "Newest activity" },
  { key: "waiting_desc", label: "Longest waiting" },
  { key: "priority_desc", label: "Priority (High first)" },
  { key: "customer_asc", label: "Customer A–Z" },
];

function stateTone(state: HandoffState): "success" | "warning" | "info" | "neutral" {
  if (state === "Resolved") return "success";
  if (state === "Waiting") return "warning";
  if (state === "Working") return "info";
  return "neutral";
}

function waitingMinutes(label: string): number {
  const n = parseInt(label, 10) || 0;
  if (label.endsWith("d")) return n * 1440;
  if (label.endsWith("h")) return n * 60;
  if (label.endsWith("m")) return n;
  if (label === "now") return 0;
  return 0;
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
  const [sortKey, setSortKey] = useState<SortKey>("updated_desc");

  const queueQuery = useQuery({
    queryKey: ["handoff-queue", orgId],
    queryFn: () => listHandoffQueue(orgId),
    refetchInterval: 5000,
  });

  const items = queueQuery.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((item) => {
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
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    return [...list].sort((a, b) => {
      if (sortKey === "waiting_desc") {
        return waitingMinutes(b.waitingLabel) - waitingMinutes(a.waitingLabel);
      }
      if (sortKey === "priority_desc") {
        const diff = priorityRank(b.priority) - priorityRank(a.priority);
        if (diff !== 0) return diff;
        return waitingMinutes(b.waitingLabel) - waitingMinutes(a.waitingLabel);
      }
      if (sortKey === "customer_asc") {
        return customerName(a).localeCompare(customerName(b));
      }
      const at = new Date(a.updated_at || a.last_message_at || a.created_at).getTime();
      const bt = new Date(b.updated_at || b.last_message_at || b.created_at).getTime();
      return bt - at;
    });
  }, [items, search, stateFilter, priorityFilter, sortKey]);

  const waiting = items.filter((i) => i.handoffState === "Waiting");
  const assigned = items.filter((i) => i.handoffState === "Assigned");
  const working = items.filter((i) => i.handoffState === "Working");
  const resolvedToday = items.filter((i) => i.handoffState === "Resolved");
  const longestWait = waiting
    .map((i) => i.waitingLabel)
    .sort((a, b) => waitingMinutes(b) - waitingMinutes(a))[0];

  const activeSortLabel = sortOptions.find((o) => o.key === sortKey)?.label ?? "Sort";
  const filterActive = stateFilter !== "All" || priorityFilter !== "All";

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["handoff-queue", orgId] }),
      queryClient.invalidateQueries({ queryKey: ["conversations", orgId] }),
    ]);
  };

  const claimMutation = useMutation({
    mutationFn: async (item: HandoffItem) => {
      if (!profile?.id) throw new Error("Sign in to take over");
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
    onError: (error) => toast.error(error instanceof Error ? error.message : "Take over failed"),
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
      await returnConversationToAi(item.id);
      return item;
    },
    onSuccess: async (item) => {
      await invalidate();
      toast.success(`Returned ${item.external_ref || item.id.slice(0, 8)} to EnerBot`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Return to AI failed"),
  });

  const busyId =
    (claimMutation.isPending && claimMutation.variables?.id) ||
    (resolveMutation.isPending && resolveMutation.variables?.id) ||
    (returnMutation.isPending && returnMutation.variables?.id) ||
    null;

  return (
    <>
      <PageHeader
        title="Human Support"
        description="Live handoff queue for escalated and human-owned conversations. Take over, resolve, or return to EnerBot."
        meta={
          <Pill tone="success" dot>
            Live queue
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
            hint={longestWait ? `longest ${longestWait}` : "no open waits"}
          />
          <StatCard
            label="Assigned"
            value={String(assigned.length)}
            hint={assigned[0]?.assignee_label || "none claimed"}
          />
          <StatCard
            label="Working"
            value={String(working.length)}
            hint={working[0]?.assignee_label || "no active replies"}
          />
          <StatCard
            label="Resolved Today"
            value={String(resolvedToday.length)}
            hint="closed in human queue today"
            trend={resolvedToday.length > 0 ? "up" : undefined}
            delta={resolvedToday.length > 0 ? String(resolvedToday.length) : undefined}
          />
        </div>

        <Panel title="Handoff Queue" description="Escalated + human conversations from Website chat and Inbox" bodyClassName="p-0">
          <Toolbar
            placeholder="Search customer, company, reason…"
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
                title={search || filterActive ? "No matching handoffs" : "Queue is clear"}
                description={
                  search || filterActive
                    ? "Try another filter or search."
                    : "When a visitor asks for a human (or an agent takes over in Inbox), threads appear here."
                }
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {["ID", "Customer", "Reason", "Priority", "Waiting", "State", "Agent", "Actions"].map((h) => (
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
                      return (
                        <tr key={q.id} className="hover:bg-secondary/40">
                          <td className="num px-4 py-3 whitespace-nowrap">{ref}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium whitespace-nowrap">{customer}</p>
                            <p className="text-xs text-muted-foreground whitespace-nowrap">{company}</p>
                          </td>
                          <td className="max-w-[220px] px-4 py-3 text-muted-foreground">
                            <span className="line-clamp-2">{q.reason}</span>
                          </td>
                          <td className="px-4 py-3">
                            <Pill tone={q.priority === "High" ? "danger" : q.priority === "Medium" ? "warning" : "neutral"}>
                              {q.priority}
                            </Pill>
                          </td>
                          <td className="num px-4 py-3 whitespace-nowrap">{q.waitingLabel || "—"}</td>
                          <td className="px-4 py-3">
                            <Pill tone={stateTone(q.handoffState)} dot>
                              {q.handoffState}
                            </Pill>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">{agent}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {q.handoffState !== "Resolved" ? (
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  disabled={rowBusy}
                                  onClick={() => claimMutation.mutate(q)}
                                >
                                  Take over
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => navigate({ to: "/inbox", search: { c: q.id } })}
                              >
                                Open thread
                              </Button>
                              {q.handoffState !== "Resolved" ? (
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
              </div>
              <TablePagination total={filtered.length} shown={filtered.length} />
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
