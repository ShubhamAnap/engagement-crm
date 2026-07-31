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

export type AutomationAction =
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
      /** Optional body vars; supports {{name}} {{company}} etc. */
      bodyParams?: string[];
    }
  | { type: "send_email"; subject: string; body: string }
  | { type: "notify_team"; title: string; body: string; href?: string };
