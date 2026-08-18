import { ArrowDown, GitBranch, Play, Timer, Zap } from "lucide-react";
import type { AutomationAction, AutomationLeafAction, AutomationTrigger } from "@/lib/automation-types";
import { ACTION_TYPE_OPTIONS, TRIGGER_OPTIONS } from "@/lib/automations-api";
import { cn } from "@/lib/utils";

function triggerLabel(trigger: AutomationTrigger, toStatus?: string) {
  const base = TRIGGER_OPTIONS.find((t) => t.value === trigger)?.label || trigger;
  if (trigger === "lead_status_changed" && toStatus) return `${base} → ${toStatus}`;
  return base;
}

function leafLabel(action: AutomationLeafAction): string {
  const typeLabel = ACTION_TYPE_OPTIONS.find((a) => a.value === action.type)?.label || action.type;
  switch (action.type) {
    case "set_lead_priority":
      return `${typeLabel}: ${action.priority}`;
    case "set_lead_status":
      return `${typeLabel}: ${action.status}`;
    case "set_follow_up_hours":
      return `${typeLabel}: ${action.hours}h`;
    case "add_lead_note":
      return `${typeLabel}: ${action.note.slice(0, 40)}`;
    case "set_sales_person":
      return `${typeLabel}: ${action.salesPerson}`;
    case "tag_conversation":
      return `${typeLabel}: ${action.tag}`;
    case "set_assignee_label":
      return `${typeLabel}: ${action.label}`;
    case "add_system_message":
      return `${typeLabel}: ${action.body.slice(0, 40)}`;
    case "send_whatsapp_template":
      return `${typeLabel}: ${action.templateName} (${action.language})`;
    case "send_email":
      return `${typeLabel}: ${action.subject.slice(0, 40)}`;
    case "notify_team":
      return `${typeLabel}: ${action.title}`;
    case "wait":
      return `Wait ${action.amount} ${action.unit}`;
    default:
      return typeLabel;
  }
}

function actionLabel(action: AutomationAction): string {
  if (action.type === "if_else") {
    const val = action.value ? ` ${action.value}` : "";
    return `If ${action.field} ${action.op}${val}`;
  }
  return leafLabel(action);
}

function NodeIcon({ type }: { type: string }) {
  if (type === "wait") return <Timer className="size-3.5 text-sky-600" />;
  if (type === "if_else") return <GitBranch className="size-3.5 text-violet-600" />;
  if (type.startsWith("send_") || type === "notify_team") {
    return <Zap className="size-3.5 text-warning" />;
  }
  return <GitBranch className="size-3.5" />;
}

function Connector() {
  return (
    <div className="flex flex-col items-center py-1">
      <div className="h-3 w-px bg-border" />
      <ArrowDown className="size-4 text-muted-foreground" />
      <div className="h-1 w-px bg-border" />
    </div>
  );
}

function MiniBranch({
  title,
  tone,
  actions,
}: {
  title: string;
  tone: "yes" | "no";
  actions: AutomationLeafAction[];
}) {
  return (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-lg border bg-card/80 p-2",
        tone === "yes" ? "border-emerald-500/40" : "border-rose-500/40",
      )}
    >
      <p
        className={cn(
          "mb-1.5 text-[10px] font-semibold uppercase tracking-wide",
          tone === "yes" ? "text-emerald-700" : "text-rose-700",
        )}
      >
        {title}
      </p>
      <div className="space-y-1.5">
        {(actions.length ? actions : [{ type: "add_lead_note", note: "(empty)" } as AutomationLeafAction]).map(
          (a, i) => (
            <div
              key={`${a.type}-${i}`}
              className="rounded-md border border-border/80 bg-background px-2 py-1.5 text-[11px] leading-snug"
            >
              {leafLabel(a)}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export function WorkflowCanvas({
  trigger,
  toStatus,
  actions,
  selectedActionIndex,
  onSelectAction,
  className,
}: {
  trigger: AutomationTrigger;
  toStatus?: string;
  actions: AutomationAction[];
  selectedActionIndex?: number | null;
  onSelectAction?: (index: number) => void;
  className?: string;
}) {
  const list = actions.length
    ? actions
    : ([{ type: "add_lead_note", note: "—" }] as AutomationAction[]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] bg-[size:16px_16px] p-4",
        className,
      )}
    >
      <div className="mx-auto flex max-w-lg flex-col items-center gap-0">
        <div className="w-full rounded-xl border-2 border-primary/40 bg-card p-3 shadow-sm">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-primary">
            <Play className="size-3.5" /> Trigger
          </div>
          <p className="text-sm font-semibold">{triggerLabel(trigger, toStatus)}</p>
        </div>

        <Connector />

        {list.map((action, i) => (
          <div key={`${action.type}-${i}`} className="flex w-full flex-col items-center">
            <button
              type="button"
              disabled={!onSelectAction}
              onClick={() => onSelectAction?.(i)}
              className={cn(
                "w-full rounded-xl border bg-card p-3 text-left shadow-sm transition-colors",
                selectedActionIndex === i
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border hover:border-primary/30",
                action.type === "wait" && "border-sky-500/35",
                action.type === "if_else" && "border-violet-500/35",
                !onSelectAction && "cursor-default",
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <NodeIcon type={action.type} />
                {action.type === "wait"
                  ? "Wait"
                  : action.type === "if_else"
                    ? "Condition"
                    : `Step ${i + 1}`}
              </div>
              <p className="text-sm font-medium">{actionLabel(action)}</p>

              {action.type === "if_else" ? (
                <div className="mt-3 flex gap-2">
                  <MiniBranch title="Yes" tone="yes" actions={action.thenActions || []} />
                  <MiniBranch title="No" tone="no" actions={action.elseActions || []} />
                </div>
              ) : null}
            </button>
            {i < list.length - 1 ? <Connector /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
