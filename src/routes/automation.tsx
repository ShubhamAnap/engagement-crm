import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Play, Plus, RefreshCw, Timer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, Panel, Pill, StatCard } from "@/components/shared/ui-kit";
import { WorkflowCanvas } from "@/components/automation/WorkflowCanvas";
import { useAuth } from "@/lib/auth";
import { ENERTECH_ORG_ID, formatRelativeTime } from "@/lib/chat-api";
import type { AutomationAction, AutomationTrigger } from "@/lib/automation-types";
import {
  ACTION_TYPE_OPTIONS,
  TRIGGER_OPTIONS,
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
  processDueFollowUpsFn,
  setAutomationStatus,
  successRate,
  testAutomationRun,
  updateAutomation,
  type AutomationStatus,
  type DbAutomation,
} from "@/lib/automations-api";
import type { LeadStatus, PriorityLevel } from "@/lib/db-types";

export const Route = createFileRoute("/automation")({
  head: () => ({
    meta: [
      { title: "Automation — EnerTech Engage" },
      {
        name: "description",
        content: "Workflows that qualify leads, sync CRM actions, and chase follow-ups automatically.",
      },
      { property: "og:title", content: "Automation — EnerTech Engage" },
    ],
  }),
  component: Page,
});

function statusTone(status: AutomationStatus): "success" | "warning" | "neutral" {
  if (status === "Live") return "success";
  if (status === "Paused") return "warning";
  return "neutral";
}

function actionSummary(action: AutomationAction): string {
  switch (action.type) {
    case "set_lead_priority":
      return `Set priority → ${action.priority}`;
    case "set_lead_status":
      return `Set status → ${action.status}`;
    case "set_follow_up_hours":
      return `Follow-up in ${action.hours}h`;
    case "add_lead_note":
      return `Note: ${action.note}`;
    case "set_sales_person":
      return `Sales person → ${action.salesPerson}`;
    case "tag_conversation":
      return `Tag: ${action.tag}`;
    case "set_assignee_label":
      return `Assignee: ${action.label}`;
    case "add_system_message":
      return `System: ${action.body}`;
    case "send_whatsapp_template":
      return `WhatsApp template → ${action.templateName} (${action.language})`;
    case "send_email":
      return `Email → ${action.subject}`;
    case "notify_team":
      return `Notify → ${action.title}`;
    default:
      return "Action";
  }
}

function defaultAction(type: AutomationAction["type"]): AutomationAction {
  switch (type) {
    case "set_lead_priority":
      return { type, priority: "High" };
    case "set_lead_status":
      return { type, status: "Contacted" };
    case "set_follow_up_hours":
      return { type, hours: 24 };
    case "add_lead_note":
      return { type, note: "Auto note" };
    case "set_sales_person":
      return { type, salesPerson: "Sales queue" };
    case "tag_conversation":
      return { type, tag: "Follow-up" };
    case "set_assignee_label":
      return { type, label: "Sales queue" };
    case "add_system_message":
      return { type, body: "Automation ran." };
    case "send_whatsapp_template":
      return { type, templateName: "followup_01", language: "en", bodyParams: ["{{name}}"] };
    case "send_email":
      return {
        type,
        subject: "EnerTech follow-up — {{name}}",
        body: "Hi {{name}},\n\nFollowing up on your enquiry for EnerTech UPS.\n\n— EnerTech Engage",
      };
    case "notify_team":
      return {
        type,
        title: "Automation alert",
        body: "{{name}} / {{company}} needs attention",
        href: "/leads",
      };
  }
}

function runSteps(output: Record<string, unknown> | null | undefined): string[] {
  const steps = output?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.map((s) => String(s));
}

function Page() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id ?? ENERTECH_ORG_ID;
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<DbAutomation | null>(null);
  const [creating, setCreating] = useState(false);

  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formStatus, setFormStatus] = useState<AutomationStatus>("Draft");
  const [formTrigger, setFormTrigger] = useState<AutomationTrigger>("lead_created");
  const [formToStatus, setFormToStatus] = useState<LeadStatus>("Proposal");
  const [formSource, setFormSource] = useState("");
  const [formPriority, setFormPriority] = useState<string>("");
  const [formChannel, setFormChannel] = useState("");
  const [formLeadStatus, setFormLeadStatus] = useState<string>("");
  const [formRequiresApproval, setFormRequiresApproval] = useState(true);
  const [formActions, setFormActions] = useState<AutomationAction[]>([
    defaultAction("set_follow_up_hours"),
  ]);

  const listQuery = useQuery({
    queryKey: ["automations", orgId],
    queryFn: () => listAutomations(orgId),
  });

  const automations = listQuery.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return automations;
    return automations.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.description || "").toLowerCase().includes(q) ||
        a.trigger_type.includes(q),
    );
  }, [automations, search]);

  const selected = automations.find((a) => a.id === selectedId) || filtered[0] || null;

  const runsQuery = useQuery({
    queryKey: ["automation-runs", selected?.id],
    enabled: Boolean(selected?.id),
    queryFn: () => listAutomationRuns(selected!.id),
  });

  const liveCount = automations.filter((a) => a.status === "Live").length;
  const totalRuns = automations.reduce((s, a) => s + (a.run_count || 0), 0);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["automations", orgId] });
    if (selected?.id) {
      await queryClient.invalidateQueries({ queryKey: ["automation-runs", selected.id] });
    }
  };

  function openCreate() {
    setCreating(true);
    setEditing(null);
    setFormName("");
    setFormDesc("");
    setFormStatus("Draft");
    setFormTrigger("lead_created");
    setFormToStatus("Proposal");
    setFormSource("");
    setFormPriority("");
    setFormChannel("");
    setFormLeadStatus("");
    setFormRequiresApproval(true);
    setFormActions([defaultAction("set_follow_up_hours")]);
  }

  function openEdit(a: DbAutomation) {
    setCreating(false);
    setEditing(a);
    setFormName(a.name);
    setFormDesc(a.description || "");
    setFormStatus(a.status);
    setFormTrigger(a.trigger_type);
    setFormToStatus(((a.trigger_config?.to_status as LeadStatus) || "Proposal") as LeadStatus);
    setFormSource(String(a.trigger_config?.source || ""));
    setFormPriority(String(a.trigger_config?.priority || ""));
    setFormChannel(String(a.trigger_config?.channel || ""));
    setFormLeadStatus(String(a.trigger_config?.lead_status || ""));
    setFormRequiresApproval(a.requires_approval !== false);
    setFormActions(a.actions?.length ? a.actions : [defaultAction("add_lead_note")]);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!formName.trim()) throw new Error("Name is required");
      if (!formActions.length) throw new Error("Add at least one action");
      const triggerConfig: Record<string, unknown> = {};
      if (formTrigger === "lead_status_changed") triggerConfig.to_status = formToStatus;
      if (formSource.trim()) triggerConfig.source = formSource.trim();
      if (formPriority) triggerConfig.priority = formPriority;
      if (formChannel.trim()) triggerConfig.channel = formChannel.trim();
      if (formLeadStatus) triggerConfig.lead_status = formLeadStatus;
      const input = {
        name: formName,
        description: formDesc,
        status: formStatus,
        triggerType: formTrigger,
        triggerConfig,
        actions: formActions,
        requiresApproval: formRequiresApproval,
      };
      if (editing) return updateAutomation(editing.id, input);
      return createAutomation(orgId, input);
    },
    onSuccess: async (row) => {
      await invalidate();
      setEditing(null);
      setCreating(false);
      setSelectedId(row.id);
      toast.success(editing ? "Workflow updated" : "Workflow created");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Save failed"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, live }: { id: string; live: boolean }) =>
      setAutomationStatus(id, live ? "Live" : "Paused"),
    onSuccess: async () => {
      await invalidate();
      toast.success("Workflow status updated");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAutomation(id),
    onSuccess: async () => {
      await invalidate();
      setSelectedId(null);
      toast.success("Workflow deleted");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Delete failed"),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => testAutomationRun({ data: { automationId: id } }),
    onSuccess: async (result) => {
      await invalidate();
      if (result.ok) {
        toast.success(`Test OK · ${result.steps.length} step(s)`);
      } else {
        toast.error(result.error || "Test failed");
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Test failed"),
  });

  const dueMutation = useMutation({
    mutationFn: () => processDueFollowUpsFn(),
    onSuccess: async (result) => {
      await invalidate();
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["automation-approvals"] });
      toast.success(
        `Due follow-ups: ${result.processed} lead(s) · ${result.pending} awaiting approval · ${result.ran} auto-run · ${result.ok} ok`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not process follow-ups"),
  });

  const dialogOpen = creating || Boolean(editing);

  return (
    <>
      <PageHeader
        title="Automation"
        description="Trigger → condition → actions for leads, WhatsApp, email, and team alerts."
        meta={
          <div className="flex flex-wrap gap-2">
            <Pill tone="success" dot>
              {liveCount} live
            </Pill>
            <Pill tone="neutral">{automations.length} workflows</Pill>
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={dueMutation.isPending}
              onClick={() => dueMutation.mutate()}
            >
              <Timer className={`size-3.5 ${dueMutation.isPending ? "animate-spin" : ""}`} />
              Process due follow-ups
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={listQuery.isFetching}
              onClick={async () => {
                await invalidate();
                toast.success("Workflows refreshed");
              }}
            >
              <RefreshCw className={`size-3.5 ${listQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" className="gap-1.5" onClick={openCreate}>
              <Plus className="size-3.5" /> New workflow
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Live workflows" value={String(liveCount)} />
          <StatCard label="Total runs" value={String(totalRuns)} />
          <StatCard
            label="Avg success"
            value={
              totalRuns
                ? `${Math.round(
                    (automations.reduce((s, a) => s + a.success_count, 0) / totalRuns) * 100,
                  )}%`
                : "—"
            }
          />
        </div>

        <Panel title="How it works">
          <p className="text-sm text-muted-foreground">
            Live workflows queue for <strong>Approve / Reject</strong> in the amber bar under the top
            nav (when “Require approval” is on — default). Nothing runs until you approve: follow-ups,
            IndiaMART remarketing, WhatsApp, email, etc. Run{" "}
            <code className="rounded bg-secondary px-1 text-xs">013_automation_approvals.sql</code>{" "}
            in Supabase. Cron still detects due follow-ups, but campaigns wait for your approval.
          </p>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Panel title="Workflows" bodyClassName="p-0">
            <div className="border-b border-border px-4 py-3">
              <Input
                placeholder="Search workflows…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {listQuery.isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading workflows…</p>
            ) : filtered.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No workflows"
                  description="Run supabase/migrations/008_automations.sql, then refresh — or create a workflow."
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((a) => {
                  const active = selected?.id === a.id;
                  return (
                    <li
                      key={a.id}
                      className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-secondary/40 ${
                        active ? "bg-secondary/50" : ""
                      }`}
                      onClick={() => setSelectedId(a.id)}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.name}</p>
                        <p className="num truncate text-xs text-muted-foreground">
                          {a.run_count.toLocaleString()} runs · {successRate(a)}% success ·{" "}
                          {TRIGGER_OPTIONS.find((t) => t.value === a.trigger_type)?.label ||
                            a.trigger_type}
                        </p>
                      </div>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={a.status === "Live"}
                          aria-label={`Toggle ${a.name}`}
                          onCheckedChange={(on) => toggleMutation.mutate({ id: a.id, live: on })}
                        />
                        <Pill tone={statusTone(a.status)} dot>
                          {a.status}
                        </Pill>
                        {a.requires_approval !== false ? (
                          <Pill tone="warning">Approval</Pill>
                        ) : (
                          <Pill tone="neutral">Auto</Pill>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel
              title={selected?.name || "Workflow detail"}
              description={selected?.description || "Select a workflow to inspect steps and runs."}
            >
              {selected ? (
                <>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openEdit(selected)}>
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={testMutation.isPending}
                      onClick={() => testMutation.mutate(selected.id)}
                    >
                      <Play className="size-3.5" /> Test run
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-destructive"
                      onClick={() => {
                        if (window.confirm(`Delete “${selected.name}”?`)) {
                          deleteMutation.mutate(selected.id);
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  </div>
                  <p className="mb-2 text-xs uppercase text-muted-foreground">Canvas</p>
                  <WorkflowCanvas
                    trigger={selected.trigger_type}
                    toStatus={
                      selected.trigger_type === "lead_status_changed"
                        ? String(selected.trigger_config?.to_status || "")
                        : undefined
                    }
                    actions={selected.actions || []}
                  />
                  <p className="mt-3 mb-2 text-xs uppercase text-muted-foreground">Action list</p>
                  <div className="space-y-1.5">
                    {(selected.actions || []).map((step, i) => (
                      <div key={`${step.type}-${i}`}>
                        <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-sm">
                          {actionSummary(step)}
                        </div>
                        {i < selected.actions.length - 1 ? (
                          <div className="flex justify-center py-0.5">
                            <ArrowDown className="size-4 text-muted-foreground" />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No workflow selected.</p>
              )}
            </Panel>

            <Panel title="Recent runs" bodyClassName="p-0">
              {!selected ? (
                <p className="p-4 text-sm text-muted-foreground">Select a workflow.</p>
              ) : runsQuery.isLoading ? (
                <p className="p-4 text-sm text-muted-foreground">Loading runs…</p>
              ) : (runsQuery.data || []).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No runs yet. Use Test run, create a lead, or Process due follow-ups.
                </p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {(runsQuery.data || []).map((r) => {
                    const steps = runSteps(r.output);
                    return (
                      <li key={r.id} className="space-y-1.5 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex flex-wrap items-center gap-2">
                            <Pill tone={r.status === "success" ? "success" : "danger"}>
                              {r.status}
                            </Pill>
                            <span className="text-muted-foreground">{r.trigger_type}</span>
                          </span>
                          <span className="num shrink-0 text-xs text-muted-foreground">
                            {formatRelativeTime(r.created_at) ||
                              new Date(r.created_at).toLocaleString()}
                          </span>
                        </div>
                        {r.error ? (
                          <p className="text-xs text-destructive">{r.error}</p>
                        ) : null}
                        {steps.length ? (
                          <ol className="list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
                            {steps.map((step, i) => (
                              <li key={i} className="truncate">
                                {step}
                              </li>
                            ))}
                          </ol>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && (setCreating(false), setEditing(null))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit workflow" : "New workflow"}</DialogTitle>
            <DialogDescription>
              Edit the canvas nodes below. Actions run top to bottom when the trigger fires.
            </DialogDescription>
          </DialogHeader>

          <WorkflowCanvas
            className="mb-2"
            trigger={formTrigger}
            toStatus={formTrigger === "lead_status_changed" ? formToStatus : undefined}
            actions={formActions}
          />

          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea rows={2} value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formStatus} onValueChange={(v: AutomationStatus) => setFormStatus(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["Live", "Paused", "Draft"] as AutomationStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Trigger</Label>
                <Select
                  value={formTrigger}
                  onValueChange={(v: AutomationTrigger) => setFormTrigger(v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGER_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Require approval before run</p>
                <p className="text-xs text-muted-foreground">
                  Shows Approve / Reject in the top amber bar. Turn off only for trusted silent CRM
                  updates.
                </p>
              </div>
              <Switch
                checked={formRequiresApproval}
                onCheckedChange={setFormRequiresApproval}
                aria-label="Require approval"
              />
            </div>
            {formTrigger === "lead_status_changed" ? (
              <div className="space-y-2">
                <Label>When status becomes</Label>
                <Select value={formToStatus} onValueChange={(v: LeadStatus) => setFormToStatus(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      [
                        "New",
                        "Contacted",
                        "Qualified",
                        "Proposal",
                        "Negotiation",
                        "Won",
                        "Lost",
                      ] as LeadStatus[]
                    ).map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-2 rounded-lg border border-border p-3">
              <Label className="text-xs uppercase text-muted-foreground">
                Conditions (optional — leave empty to match all)
              </Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Source</Label>
                  <Input
                    placeholder="e.g. indiamart, website"
                    value={formSource}
                    onChange={(e) => setFormSource(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Priority</Label>
                  <Select
                    value={formPriority || "any"}
                    onValueChange={(v) => setFormPriority(v === "any" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Any" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      {(["High", "Medium", "Low"] as PriorityLevel[]).map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Channel</Label>
                  <Input
                    placeholder="e.g. whatsapp, website"
                    value={formChannel}
                    onChange={(e) => setFormChannel(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Lead status</Label>
                  <Select
                    value={formLeadStatus || "any"}
                    onValueChange={(v) => setFormLeadStatus(v === "any" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Any" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      {(
                        [
                          "New",
                          "Contacted",
                          "Qualified",
                          "Proposal",
                          "Negotiation",
                          "Won",
                          "Lost",
                        ] as LeadStatus[]
                      ).map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Actions</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setFormActions((prev) => [...prev, defaultAction("add_lead_note")])
                  }
                >
                  Add action
                </Button>
              </div>
              <div className="space-y-3">
                {formActions.map((action, index) => (
                  <div key={index} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2">
                      <Select
                        value={action.type}
                        onValueChange={(v: AutomationAction["type"]) => {
                          setFormActions((prev) =>
                            prev.map((a, i) => (i === index ? defaultAction(v) : a)),
                          );
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ACTION_TYPE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={index === 0}
                        onClick={() =>
                          setFormActions((prev) => {
                            const next = [...prev];
                            const tmp = next[index - 1];
                            next[index - 1] = next[index];
                            next[index] = tmp;
                            return next;
                          })
                        }
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={index === formActions.length - 1}
                        onClick={() =>
                          setFormActions((prev) => {
                            const next = [...prev];
                            const tmp = next[index + 1];
                            next[index + 1] = next[index];
                            next[index] = tmp;
                            return next;
                          })
                        }
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setFormActions((prev) => prev.filter((_, i) => i !== index))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                    {action.type === "set_lead_priority" ? (
                      <Select
                        value={action.priority}
                        onValueChange={(v: PriorityLevel) =>
                          setFormActions((prev) =>
                            prev.map((a, i) =>
                              i === index ? { type: "set_lead_priority", priority: v } : a,
                            ),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["High", "Medium", "Low"] as PriorityLevel[]).map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    {action.type === "set_lead_status" ? (
                      <Select
                        value={action.status}
                        onValueChange={(v: LeadStatus) =>
                          setFormActions((prev) =>
                            prev.map((a, i) =>
                              i === index ? { type: "set_lead_status", status: v } : a,
                            ),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            [
                              "New",
                              "Contacted",
                              "Qualified",
                              "Proposal",
                              "Negotiation",
                              "Won",
                              "Lost",
                            ] as LeadStatus[]
                          ).map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    {action.type === "set_follow_up_hours" ? (
                      <Input
                        type="number"
                        min={1}
                        value={action.hours}
                        onChange={(e) =>
                          setFormActions((prev) =>
                            prev.map((a, i) =>
                              i === index
                                ? {
                                    type: "set_follow_up_hours",
                                    hours: Number(e.target.value) || 1,
                                  }
                                : a,
                            ),
                          )
                        }
                      />
                    ) : null}
                    {action.type === "add_lead_note" ? (
                      <Input
                        value={action.note}
                        onChange={(e) =>
                          setFormActions((prev) =>
                            prev.map((a, i) =>
                              i === index ? { type: "add_lead_note", note: e.target.value } : a,
                            ),
                          )
                        }
                      />
                    ) : null}
                    {action.type === "tag_conversation" ? (
                      <Input
                        value={action.tag}
                        onChange={(e) =>
                          setFormActions((prev) =>
                            prev.map((a, i) =>
                              i === index
                                ? { type: "tag_conversation", tag: e.target.value }
                                : a,
                            ),
                          )
                        }
                      />
                    ) : null}
                    {action.type === "set_assignee_label" ? (
                      <Input
                        value={action.label}
                        onChange={(e) =>
                          setFormActions((prev) =>
                            prev.map((a, i) =>
                              i === index
                                ? { type: "set_assignee_label", label: e.target.value }
                                : a,
                            ),
                          )
                        }
                      />
                    ) : null}
                    {action.type === "add_system_message" ? (
                      <Input
                        value={action.body}
                        onChange={(e) =>
                          setFormActions((prev) =>
                            prev.map((a, i) =>
                              i === index
                                ? { type: "add_system_message", body: e.target.value }
                                : a,
                            ),
                          )
                        }
                      />
                    ) : null}
                    {action.type === "set_sales_person" ? (
                      <Input
                        placeholder="Sales person name"
                        value={action.salesPerson}
                        onChange={(e) =>
                          setFormActions((prev) =>
                            prev.map((a, i) =>
                              i === index
                                ? { type: "set_sales_person", salesPerson: e.target.value }
                                : a,
                            ),
                          )
                        }
                      />
                    ) : null}
                    {action.type === "send_whatsapp_template" ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          placeholder="Template name (Meta)"
                          value={action.templateName}
                          onChange={(e) =>
                            setFormActions((prev) =>
                              prev.map((a, i) =>
                                i === index && a.type === "send_whatsapp_template"
                                  ? { ...a, templateName: e.target.value }
                                  : a,
                              ),
                            )
                          }
                        />
                        <Input
                          placeholder="Language (en)"
                          value={action.language}
                          onChange={(e) =>
                            setFormActions((prev) =>
                              prev.map((a, i) =>
                                i === index && a.type === "send_whatsapp_template"
                                  ? { ...a, language: e.target.value }
                                  : a,
                              ),
                            )
                          }
                        />
                        <Input
                          className="sm:col-span-2"
                          placeholder="Body params CSV — {{name}},{{company}}"
                          value={(action.bodyParams || []).join(",")}
                          onChange={(e) =>
                            setFormActions((prev) =>
                              prev.map((a, i) =>
                                i === index && a.type === "send_whatsapp_template"
                                  ? {
                                      ...a,
                                      bodyParams: e.target.value
                                        .split(",")
                                        .map((s) => s.trim())
                                        .filter(Boolean),
                                    }
                                  : a,
                              ),
                            )
                          }
                        />
                      </div>
                    ) : null}
                    {action.type === "send_email" ? (
                      <div className="space-y-2">
                        <Input
                          placeholder="Subject ({{name}} ok)"
                          value={action.subject}
                          onChange={(e) =>
                            setFormActions((prev) =>
                              prev.map((a, i) =>
                                i === index && a.type === "send_email"
                                  ? { ...a, subject: e.target.value }
                                  : a,
                              ),
                            )
                          }
                        />
                        <Textarea
                          rows={3}
                          placeholder="Body"
                          value={action.body}
                          onChange={(e) =>
                            setFormActions((prev) =>
                              prev.map((a, i) =>
                                i === index && a.type === "send_email"
                                  ? { ...a, body: e.target.value }
                                  : a,
                              ),
                            )
                          }
                        />
                      </div>
                    ) : null}
                    {action.type === "notify_team" ? (
                      <div className="space-y-2">
                        <Input
                          placeholder="Title"
                          value={action.title}
                          onChange={(e) =>
                            setFormActions((prev) =>
                              prev.map((a, i) =>
                                i === index && a.type === "notify_team"
                                  ? { ...a, title: e.target.value }
                                  : a,
                              ),
                            )
                          }
                        />
                        <Input
                          placeholder="Body ({{name}} / {{company}})"
                          value={action.body}
                          onChange={(e) =>
                            setFormActions((prev) =>
                              prev.map((a, i) =>
                                i === index && a.type === "notify_team"
                                  ? { ...a, body: e.target.value }
                                  : a,
                              ),
                            )
                          }
                        />
                        <Input
                          placeholder="Link href e.g. /leads or /human-support"
                          value={action.href || ""}
                          onChange={(e) =>
                            setFormActions((prev) =>
                              prev.map((a, i) =>
                                i === index && a.type === "notify_team"
                                  ? { ...a, href: e.target.value }
                                  : a,
                              ),
                            )
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? "Saving…" : "Save workflow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
