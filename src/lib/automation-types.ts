import type { LeadStatus, PriorityLevel } from "@/lib/db-types";

export type AutomationTrigger =
  | "lead_created"
  | "indiamart_lead"
  | "tradeindia_lead"
  | "conversation_escalated"
  | "lead_status_changed"
  | "follow_up_due";

/** Optional filters stored in `trigger_config` (empty = match all). */
export type AutomationTriggerConfig = {
  to_status?: LeadStatus | string;
  source?: string;
  priority?: PriorityLevel | string;
  channel?: string;
  lead_status?: LeadStatus | string;
};

/** Fields usable inside If / Else conditions (WATI-style branching). */
export type AutomationConditionField =
  | "lead_status"
  | "priority"
  | "source"
  | "channel"
  | "has_phone"
  | "has_email"
  | "sales_person";

export type AutomationConditionOp = "eq" | "neq" | "contains" | "is_set" | "is_empty";

export type AutomationWaitUnit = "minutes" | "hours" | "days";

/** Leaf actions only — used inside If/Else branches (no nested if_else). */
export type AutomationLeafAction =
  | { type: "set_lead_priority"; priority: PriorityLevel }
  | { type: "set_lead_status"; status: LeadStatus }
  | { type: "set_follow_up_hours"; hours: number }
  | { type: "add_lead_note"; note: string }
  | { type: "tag_conversation"; tag: string }
  | { type: "set_assignee_label"; label: string }
  | { type: "add_system_message"; body: string }
  | { type: "set_sales_person"; salesPerson: string }
  | {
      type: "send_whatsapp_template";
      templateName: string;
      language: string;
      bodyParams?: string[];
    }
  | { type: "send_email"; subject: string; body: string }
  | { type: "notify_team"; title: string; body: string; href?: string }
  | { type: "wait"; amount: number; unit: AutomationWaitUnit };

export type AutomationAction =
  | AutomationLeafAction
  | {
      type: "if_else";
      field: AutomationConditionField;
      op: AutomationConditionOp;
      value?: string;
      thenActions: AutomationLeafAction[];
      elseActions: AutomationLeafAction[];
    };
