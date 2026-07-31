import { ArrowDown, GitBranch, Play, Zap } from "lucide-react";
import type { AutomationAction, AutomationTrigger } from "@/lib/automation-types";
import { ACTION_TYPE_OPTIONS, TRIGGER_OPTIONS } from "@/lib/automations-api";
import { cn } from "@/lib/utils";

function triggerLabel(trigger: AutomationTrigger, toStatus?: string) {
  const base = TRIGGER_OPTIONS.find((t) => t.value === trigger)?.label || trigger;
  if (trigger === "lead_status_changed" && toStatus) return `${base} → ${toStatus}`;
  return base;
}

function actionLabel(action: AutomationAction): string {
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
    default:
      return typeLabel;
  }
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
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] bg-[size:16px_16px] p-4",
        className,
      )}
    >
      <div className="mx-auto flex max-w-md flex-col items-center gap-0">
        <div className="w-full rounded-xl border-2 border-primary/40 bg-card p-3 shadow-sm">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-primary">
            <Play className="size-3.5" /> Trigger
          </div>
          <p className="text-sm font-semibold">{triggerLabel(trigger, toStatus)}</p>
        </div>

        <div className="flex flex-col items-center py-1">
          <div className="h-4 w-px bg-border" />
          <ArrowDown className="size-4 text-muted-foreground" />
          <div className="h-2 w-px bg-border" />
        </div>

        {(actions.length ? actions : [{ type: "add_lead_note", note: "—" } as AutomationAction]).map(
          (action, i) => (
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
                  !onSelectAction && "cursor-default",
                )}
              >
                <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {action.type.startsWith("send_") || action.type === "notify_team" ? (
                    <Zap className="size-3.5 text-amber-600" />
                  ) : (
                    <GitBranch className="size-3.5" />
                  )}
                  Step {i + 1}
                </div>
                <p className="text-sm font-medium">{actionLabel(action)}</p>
              </button>
              {i < (actions.length || 1) - 1 ? (
                <div className="flex flex-col items-center py-1">
                  <div className="h-3 w-px bg-border" />
                  <ArrowDown className="size-4 text-muted-foreground" />
                  <div className="h-1 w-px bg-border" />
                </div>
              ) : null}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
