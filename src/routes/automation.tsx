import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Bot, Pencil, Play, Plus, RefreshCw, Timer, Trash2 } from "lucide-react";
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
import type {
  AutomationAction,
  AutomationConditionField,
  AutomationConditionOp,
  AutomationLeafAction,
  AutomationTrigger,
  AutomationWaitUnit,
} from "@/lib/automation-types";
import {
  ACTION_TYPE_OPTIONS,
  CONDITION_FIELD_OPTIONS,
  CONDITION_OP_OPTIONS,
  LEAF_ACTION_TYPE_OPTIONS,
  TRIGGER_OPTIONS,
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
  processDueFollowUpsFn,
  proposeDailyFollowUpCampaignFn,
  setAutomationStatus,
  successRate,
  testAutomationRun,
  updateAutomation,
  type AutomationStatus,
  type DbAutomation,
} from "@/lib/automations-api";
import type { LeadStatus, PriorityLevel, ChannelType } from "@/lib/db-types";
import { normalizeTriggerFilterList } from "@/lib/automation-types";
import { WA_CRM_FIELD_OPTIONS, parseStoredBindings, defaultBindingsForLabels, type WaParamBinding } from "@/lib/wa-template-merge";
import { listWaTemplates, analyzeWaTemplateFromRow, type DbWaTemplate } from "@/lib/broadcasting-api";
import {
  listSalesPersonDirectory,
  upsertSalesPerson,
  deleteSalesPerson,
  type DbSalesPerson,
} from "@/lib/sales-person-directory-api";

const AUTOMATION_SOURCE_OPTIONS: ChannelType[] = [
  "website",
  "whatsapp",
  "email",
  "indiamart",
  "tradeindia",
  "brainmine",
  "instagram",
  "facebook",
  "api",
  "webhook",
];

const AUTOMATION_CHANNEL_OPTIONS: ChannelType[] = [
  "whatsapp",
  "website",
  "email",
  "instagram",
  "facebook",
  "indiamart",
  "tradeindia",
];

function MultiCheckFilter({
  label,
  options,
  selected,
  onChange,
  hint,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  hint?: string;
}) {
  const allSelected = selected.length === 0;
  const toggle = (value: string) => {
    const v = value.toLowerCase();
    if (selected.map((s) => s.toLowerCase()).includes(v)) {
      onChange(selected.filter((s) => s.toLowerCase() !== v));
    } else {
      onChange([...selected, value]);
    }
  };
  return (
    <div className="space-y-1.5 sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => onChange([])}
        >
          {allSelected ? "All (any)" : "Clear → All"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-border p-2">
        {options.map((opt) => {
          const on = selected.map((s) => s.toLowerCase()).includes(opt.toLowerCase());
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={`rounded-md border px-2 py-1 text-xs capitalize transition-colors ${
                on
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-transparent bg-secondary/60 text-muted-foreground hover:bg-secondary"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {allSelected
          ? "Matching all sources/channels (none selected = Any)."
          : `Matching: ${selected.join(", ")}`}
        {hint ? ` ${hint}` : ""}
      </p>
    </div>
  );
}

function WaTemplateActionEditor({
  action,
  onChange,
  orgId,
}: {
  action: Extract<AutomationLeafAction, { type: "send_whatsapp_template" }>;
  onChange: (next: AutomationLeafAction) => void;
  orgId: string;
}) {
  const templatesQuery = useQuery({
    queryKey: ["wa-templates", orgId],
    queryFn: () => listWaTemplates(orgId),
  });
  const approved = useMemo(
    () => (templatesQuery.data ?? []).filter((t) => t.status === "APPROVED"),
    [templatesQuery.data],
  );

  const selectedTpl: DbWaTemplate | null =
    approved.find((t) => t.name === action.templateName && t.language === action.language) ||
    approved.find((t) => t.name === action.templateName) ||
    null;

  const spec = selectedTpl ? analyzeWaTemplateFromRow(selectedTpl) : null;
  const expectedLabels = spec?.bodyVarLabels?.length
    ? spec.bodyVarLabels
    : Array.from({ length: spec?.bodyVarCount || 0 }, (_, i) => String(i + 1));

  const bindings: WaParamBinding[] =
    action.bodyParamBindings && action.bodyParamBindings.length > 0
      ? action.bodyParamBindings
      : parseStoredBindings(action.bodyParams || [], expectedLabels.length ? expectedLabels : ["name"]);

  const patch = (nextBindings: WaParamBinding[]) =>
    onChange({ ...action, bodyParamBindings: nextBindings, bodyParams: undefined });

  const selectTemplate = (tplId: string) => {
    const tpl = approved.find((t) => t.id === tplId);
    if (!tpl) return;
    const nextSpec = analyzeWaTemplateFromRow(tpl);
    const labels =
      nextSpec.bodyVarLabels.length > 0
        ? nextSpec.bodyVarLabels
        : Array.from({ length: nextSpec.bodyVarCount }, (_, i) => String(i + 1));
    onChange({
      ...action,
      templateName: tpl.name,
      language: tpl.language || "en",
      bodyParamBindings: defaultBindingsForLabels(labels),
      bodyParams: undefined,
    });
  };

  return (
    <div className="space-y-2 sm:col-span-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Meta template</Label>
          <Select
            value={selectedTpl?.id || ""}
            onValueChange={selectTemplate}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  templatesQuery.isLoading
                    ? "Loading templates…"
                    : approved.length
                      ? "Select APPROVED template"
                      : "No approved templates — Sync from Meta"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {approved.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} · {t.language}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Language</Label>
          <Input
            placeholder="en"
            value={action.language}
            onChange={(e) => onChange({ ...action, language: e.target.value })}
          />
        </div>
      </div>
      {!action.templateName ? (
        <p className="text-[11px] text-muted-foreground">
          Pick an APPROVED template from Broadcasting sync. Message is sent to the{" "}
          <strong>customer/lead phone</strong>.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Template <code className="rounded bg-secondary px-1">{action.templateName}</code>
          {spec ? ` · ${spec.bodyVarCount} body variable(s)` : ""}. Map each variable to a lead
          column. Sales person emails are converted to directory names at send time.
        </p>
      )}
      {bindings.map((binding, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-border/60 p-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">
              Variable {i + 1}
              {expectedLabels[i] ? (
                <span className="ml-1 font-normal text-muted-foreground">{`{{${expectedLabels[i]}}}`}</span>
              ) : null}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                const next = [...bindings];
                next.splice(i, 1);
                patch(next);
              }}
            >
              Remove
            </Button>
          </div>
          <Select
            value={binding.source}
            onValueChange={(v) => {
              const next = [...bindings];
              next[i] = {
                source: v as WaParamBinding["source"],
                staticValue: v === "__static__" ? next[i]?.staticValue || "" : undefined,
              };
              patch(next);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="CRM column" />
            </SelectTrigger>
            <SelectContent>
              {WA_CRM_FIELD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {binding.source === "__static__" ? (
            <Input
              placeholder="Fixed text for all runs"
              value={binding.staticValue || ""}
              onChange={(e) => {
                const next = [...bindings];
                next[i] = { source: "__static__", staticValue: e.target.value };
                patch(next);
              }}
            />
          ) : null}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => patch([...bindings, { source: "name" }])}
      >
        Add variable mapping
      </Button>
    </div>
  );
}

function SalesPersonDirectoryPanel({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["sales-person-directory", orgId],
    queryFn: () => listSalesPersonDirectory(orgId),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertSalesPerson({
        orgId,
        id: editingId || undefined,
        email,
        displayName: name,
        mobile,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-person-directory", orgId] });
      setEmail("");
      setName("");
      setMobile("");
      setEditingId(null);
      toast.success(editingId ? "Sales person updated" : "Sales person added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSalesPerson(id, orgId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-person-directory", orgId] });
      toast.success("Removed from directory");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const rows = listQuery.data ?? [];

  function startEdit(row: DbSalesPerson) {
    setEditingId(row.id);
    setEmail(row.email);
    setName(row.display_name);
    setMobile(row.mobile || "");
  }

  return (
    <Panel
      title="Sales person directory"
      description="Map sales emails on leads to WhatsApp display names (and optional mobile). Example: saibal@enertechups.com → Mr.Saibal."
      bodyClassName="space-y-4 p-4"
    >
      <div className="grid gap-2 sm:grid-cols-4">
        <Input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          placeholder="Display name (Mr.Saibal)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          placeholder="Mobile (optional)"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            disabled={saveMutation.isPending || !email.trim() || !name.trim()}
            onClick={() => saveMutation.mutate()}
          >
            {editingId ? "Update" : "Add"}
          </Button>
          {editingId ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingId(null);
                setEmail("");
                setName("");
                setMobile("");
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {listQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading directory…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sales people yet. Add email + name so WhatsApp templates show names instead of emails.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{row.display_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.email}
                  {row.mobile ? ` · ${row.mobile}` : ""}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => startEdit(row)}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(row.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export const Route = createFileRoute("/automation")({
  head: () => ({
    meta: [
      { title: "Automation — EnerTech Engage" },
      {
        name: "description",
        content:
          "WATI-style workflows: triggers, Wait delays, If/Else branches, WhatsApp, email, and CRM actions.",
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
    case "wait":
      return `Wait ${action.amount} ${action.unit}`;
    case "if_else":
      return `If ${action.field} ${action.op}${action.value ? ` ${action.value}` : ""} → Yes ${action.thenActions?.length || 0} / No ${action.elseActions?.length || 0}`;
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

function defaultLeafAction(type: AutomationLeafAction["type"]): AutomationLeafAction {
  switch (type) {
    case "wait":
      return { type: "wait", amount: 30, unit: "minutes" };
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
      return {
        type,
        templateName: "followup_01",
        language: "en",
        bodyParamBindings: [{ source: "name" }],
      };
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

function defaultAction(type: AutomationAction["type"]): AutomationAction {
  if (type === "if_else") {
    return {
      type: "if_else",
      field: "has_phone",
      op: "is_set",
      value: "",
      thenActions: [defaultLeafAction("send_whatsapp_template")],
      elseActions: [defaultLeafAction("notify_team")],
    };
  }
  return defaultLeafAction(type);
}

function LeafActionFields({
  action,
  onChange,
  orgId,
}: {
  action: AutomationLeafAction;
  onChange: (next: AutomationLeafAction) => void;
  orgId: string;
}) {
  const salesDirQuery = useQuery({
    queryKey: ["sales-person-directory", orgId],
    queryFn: () => listSalesPersonDirectory(orgId),
    enabled: action.type === "set_sales_person",
  });
  const salesPeople = salesDirQuery.data ?? [];

  return (
    <div className="space-y-2">
      {action.type === "wait" ? (
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            min={1}
            value={action.amount}
            onChange={(e) =>
              onChange({
                type: "wait",
                amount: Math.max(1, Number(e.target.value) || 1),
                unit: action.unit,
              })
            }
          />
          <Select
            value={action.unit}
            onValueChange={(v: AutomationWaitUnit) =>
              onChange({ type: "wait", amount: action.amount, unit: v })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">Minutes</SelectItem>
              <SelectItem value="hours">Hours</SelectItem>
              <SelectItem value="days">Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {action.type === "set_lead_priority" ? (
        <Select
          value={action.priority}
          onValueChange={(v: PriorityLevel) => onChange({ type: "set_lead_priority", priority: v })}
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
          onValueChange={(v: LeadStatus) => onChange({ type: "set_lead_status", status: v })}
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
            onChange({ type: "set_follow_up_hours", hours: Number(e.target.value) || 1 })
          }
        />
      ) : null}
      {action.type === "add_lead_note" ? (
        <Input
          value={action.note}
          onChange={(e) => onChange({ type: "add_lead_note", note: e.target.value })}
        />
      ) : null}
      {action.type === "tag_conversation" ? (
        <Input
          value={action.tag}
          onChange={(e) => onChange({ type: "tag_conversation", tag: e.target.value })}
        />
      ) : null}
      {action.type === "set_assignee_label" ? (
        <Input
          value={action.label}
          onChange={(e) => onChange({ type: "set_assignee_label", label: e.target.value })}
        />
      ) : null}
      {action.type === "add_system_message" ? (
        <Input
          value={action.body}
          onChange={(e) => onChange({ type: "add_system_message", body: e.target.value })}
        />
      ) : null}
      {action.type === "set_sales_person" ? (
        <div className="space-y-2">
          <Select
            value={
              salesPeople.find(
                (p) =>
                  p.display_name === action.salesPerson ||
                  p.email.toLowerCase() === action.salesPerson.trim().toLowerCase(),
              )?.id || "__custom__"
            }
            onValueChange={(id) => {
              if (id === "__custom__") return;
              const person = salesPeople.find((p) => p.id === id);
              if (person) onChange({ type: "set_sales_person", salesPerson: person.display_name });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick from directory" />
            </SelectTrigger>
            <SelectContent>
              {salesPeople.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.display_name} ({p.email})
                </SelectItem>
              ))}
              <SelectItem value="__custom__">Custom / type below</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Sales person name (or email — directory resolves at send)"
            value={action.salesPerson}
            onChange={(e) => onChange({ type: "set_sales_person", salesPerson: e.target.value })}
          />
        </div>
      ) : null}
      {action.type === "send_whatsapp_template" ? (
        <WaTemplateActionEditor action={action} onChange={onChange} orgId={orgId} />
      ) : null}
      {action.type === "send_email" ? (
        <div className="space-y-2">
          <Input
            placeholder="Subject ({{name}} ok)"
            value={action.subject}
            onChange={(e) => onChange({ ...action, subject: e.target.value })}
          />
          <Textarea
            rows={3}
            placeholder="Body"
            value={action.body}
            onChange={(e) => onChange({ ...action, body: e.target.value })}
          />
        </div>
      ) : null}
      {action.type === "notify_team" ? (
        <div className="space-y-2">
          <Input
            placeholder="Title"
            value={action.title}
            onChange={(e) => onChange({ ...action, title: e.target.value })}
          />
          <Input
            placeholder="Body"
            value={action.body}
            onChange={(e) => onChange({ ...action, body: e.target.value })}
          />
          <Input
            placeholder="Href (optional)"
            value={action.href || ""}
            onChange={(e) => onChange({ ...action, href: e.target.value || undefined })}
          />
        </div>
      ) : null}
    </div>
  );
}

function BranchEditor({
  label,
  tone,
  actions,
  onChange,
  orgId,
}: {
  label: string;
  tone: "yes" | "no";
  actions: AutomationLeafAction[];
  onChange: (next: AutomationLeafAction[]) => void;
  orgId: string;
}) {
  return (
    <div
      className={`space-y-2 rounded-lg border p-2.5 ${
        tone === "yes" ? "border-emerald-500/35 bg-emerald-500/5" : "border-rose-500/35 bg-rose-500/5"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-semibold uppercase tracking-wide">{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => onChange([...actions, defaultLeafAction("add_lead_note")])}
        >
          Add step
        </Button>
      </div>
      {actions.map((leaf, bi) => (
        <div key={bi} className="space-y-2 rounded-md border border-border bg-background p-2">
          <div className="flex items-center gap-2">
            <Select
              value={leaf.type}
              onValueChange={(v: AutomationLeafAction["type"]) => {
                const next = [...actions];
                next[bi] = defaultLeafAction(v);
                onChange(next);
              }}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAF_ACTION_TYPE_OPTIONS.map((o) => (
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
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => onChange(actions.filter((_, i) => i !== bi))}
            >
              Remove
            </Button>
          </div>
          <LeafActionFields
            action={leaf}
            orgId={orgId}
            onChange={(next) => {
              const copy = [...actions];
              copy[bi] = next;
              onChange(copy);
            }}
          />
        </div>
      ))}
      {!actions.length ? (
        <p className="text-xs text-muted-foreground">No steps — branch does nothing.</p>
      ) : null}
    </div>
  );
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
  const [formSource, setFormSource] = useState<string[]>([]);
  const [formPriority, setFormPriority] = useState<string>("");
  const [formChannel, setFormChannel] = useState<string[]>([]);
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
    setFormSource([]);
    setFormPriority("");
    setFormChannel([]);
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
    setFormSource(normalizeTriggerFilterList(a.trigger_config?.source));
    setFormPriority(String(a.trigger_config?.priority || ""));
    setFormChannel(normalizeTriggerFilterList(a.trigger_config?.channel));
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
      if (formSource.length) triggerConfig.source = formSource;
      if (formPriority) triggerConfig.priority = formPriority;
      if (formChannel.length) triggerConfig.channel = formChannel;
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
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : "Save failed",
      ),
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
      const waits = result.waits;
      const waitPart =
        waits && typeof waits === "object" && "processed" in waits
          ? ` · Waits: ${waits.processed} resumed (${waits.ok} ok)`
          : "";
      toast.success(
        `Due: ${result.processed} lead(s) · ${result.pending} approval · ${result.ran} ran · ${result.ok} ok${waitPart}`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not process follow-ups"),
  });

  const dailyFollowMutation = useMutation({
    mutationFn: () => proposeDailyFollowUpCampaignFn({ data: { force: true } }),
    onSuccess: async (result) => {
      await invalidate();
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["automation-approvals"] });
      if (result.skipped === "no_leads_need_follow_up") {
        toast.message("Follow-up Agent: no open leads need a nudge today");
        return;
      }
      if (result.skipped === "already_proposed_today" && result.approvalId) {
        toast.message("Today’s follow-up proposal is already waiting for approval");
        return;
      }
      if (result.approvalId) {
        toast.success(
          `Follow-up Agent proposed ${result.leadCount ?? 0} lead(s) — approve in the amber bar`,
        );
        return;
      }
      toast.message(result.skipped || "No proposal created");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Follow-up Agent proposal failed"),
  });

  const dialogOpen = creating || Boolean(editing);

  return (
    <>
      <PageHeader
        title="Automation"
        description="WATI-style builder: Trigger → Wait → If/Else → WhatsApp / email / CRM actions."
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
              Process due + waits
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={dailyFollowMutation.isPending}
              onClick={() => dailyFollowMutation.mutate()}
              title="Follow-up Agent picks open leads and queues one campaign for your approval"
            >
              <Bot className={`size-3.5 ${dailyFollowMutation.isPending ? "animate-pulse" : ""}`} />
              Suggest today’s follow-up
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
            <br />
            <br />
            <strong>Follow-up Agent</strong> (daily): cron or{" "}
            <em>Suggest today’s follow-up</em> picks open leads that need a nudge, queues{" "}
            <strong>one</strong> approval. After you Approve, it WhatsApps (or emails) each lead.
            Optional env: <code className="rounded bg-secondary px-1 text-xs">FOLLOWUP_WA_TEMPLATE_NAME</code>.
            The Agents page “followup” prompt is only for chat — it does not create campaigns by itself.
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

        <SalesPersonDirectoryPanel orgId={orgId} />
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
            {formTrigger === "website_visitor_captured" ? (
              <p className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                Fires for each website chatbot session when a phone number is known (first visit after
                the contact form, and again when the visitor returns in a new session or after 12+
                hours). Use <strong>Send WhatsApp template</strong> with an approved Meta template —
                free-form WhatsApp text will not work for first contact.
              </p>
            ) : null}

            <div className="space-y-2 rounded-lg border border-border p-3">
              <Label className="text-xs uppercase text-muted-foreground">
                Conditions (optional — leave empty / All to match all)
              </Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <MultiCheckFilter
                  label="Source (pick one, several, or All)"
                  options={AUTOMATION_SOURCE_OPTIONS}
                  selected={formSource}
                  onChange={setFormSource}
                  hint="Chatbot widget leads usually use source “website”."
                />
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
                <MultiCheckFilter
                  label="Channel (pick one, several, or All)"
                  options={AUTOMATION_CHANNEL_OPTIONS}
                  selected={formChannel}
                  onChange={setFormChannel}
                />
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
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setFormActions((prev) => [...prev, defaultAction("wait")])}
                  >
                    + Wait
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setFormActions((prev) => [...prev, defaultAction("if_else")])}
                  >
                    + If / Else
                  </Button>
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
                    {action.type === "if_else" ? (
                      <div className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-3">
                          <Select
                            value={action.field}
                            onValueChange={(v: AutomationConditionField) =>
                              setFormActions((prev) =>
                                prev.map((a, i) =>
                                  i === index && a.type === "if_else" ? { ...a, field: v } : a,
                                ),
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Field" />
                            </SelectTrigger>
                            <SelectContent>
                              {CONDITION_FIELD_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={action.op}
                            onValueChange={(v: AutomationConditionOp) =>
                              setFormActions((prev) =>
                                prev.map((a, i) =>
                                  i === index && a.type === "if_else" ? { ...a, op: v } : a,
                                ),
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Operator" />
                            </SelectTrigger>
                            <SelectContent>
                              {CONDITION_OP_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {action.op === "is_set" || action.op === "is_empty" ? (
                            <Input disabled placeholder="—" value="" />
                          ) : (
                            <Input
                              placeholder="Compare value"
                              value={action.value || ""}
                              onChange={(e) =>
                                setFormActions((prev) =>
                                  prev.map((a, i) =>
                                    i === index && a.type === "if_else"
                                      ? { ...a, value: e.target.value }
                                      : a,
                                  ),
                                )
                              }
                            />
                          )}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <BranchEditor
                            label="Yes branch"
                            tone="yes"
                            orgId={orgId}
                            actions={action.thenActions || []}
                            onChange={(thenActions) =>
                              setFormActions((prev) =>
                                prev.map((a, i) =>
                                  i === index && a.type === "if_else" ? { ...a, thenActions } : a,
                                ),
                              )
                            }
                          />
                          <BranchEditor
                            label="No branch"
                            tone="no"
                            orgId={orgId}
                            actions={action.elseActions || []}
                            onChange={(elseActions) =>
                              setFormActions((prev) =>
                                prev.map((a, i) =>
                                  i === index && a.type === "if_else" ? { ...a, elseActions } : a,
                                ),
                              )
                            }
                          />
                        </div>
                      </div>
                    ) : (
                      <LeafActionFields
                        action={action}
                        orgId={orgId}
                        onChange={(next) =>
                          setFormActions((prev) =>
                            prev.map((a, i) => (i === index ? next : a)),
                          )
                        }
                      />
                    )}
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
