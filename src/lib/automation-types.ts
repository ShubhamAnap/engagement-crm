import type { LeadStatus, PriorityLevel } from "@/lib/db-types";

export type AutomationTrigger =
  | "lead_created"
  | "indiamart_lead"
  | "tradeindia_lead"
  | "brainmine_lead"
  | "website_visitor_captured"
  | "conversation_escalated"
  | "lead_status_changed"
  | "follow_up_due";

/** Optional filters stored in `trigger_config` (empty = match all). */
export type AutomationTriggerConfig = {
  to_status?: LeadStatus | string;
  /** One source, several sources, or omit/empty = all */
  source?: string | string[];
  priority?: PriorityLevel | string;
  /** One channel, several channels, or omit/empty = all */
  channel?: string | string[];
  lead_status?: LeadStatus | string;
};

/** Normalize legacy single string / comma list / array → lowercase list (empty = any). */
export function normalizeTriggerFilterList(value: unknown): string[] {
  if (value == null || value === "" || value === "any") return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => String(v).trim().toLowerCase())
      .filter((v) => v && v !== "any");
  }
  return String(value)
    .split(/[,|]/)
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v && v !== "any");
}

/** True when filter is empty (match all) or actual is in the allowed list. */
export function triggerFilterMatches(expected: unknown, actual: string | null | undefined): boolean {
  const allowed = normalizeTriggerFilterList(expected);
  if (!allowed.length) return true;
  if (!actual) return false;
  const a = String(actual).trim().toLowerCase();
  return allowed.includes(a);
}

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
      /** @deprecated Prefer bodyParamBindings — tokens like {{name}} still work via fillVars */
      bodyParams?: string[];
      /** Ordered map of each Meta body variable → CRM column or fixed text */
      bodyParamBindings?: Array<{
        source:
          | "name"
          | "first_name"
          | "company"
          | "email"
          | "phone"
          | "requirement"
          | "sales_person"
          | "location"
          | "source"
          | "status"
          | "notes"
          | "__static__";
        staticValue?: string;
      }>;
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
