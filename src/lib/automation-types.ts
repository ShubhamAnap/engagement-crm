import type { LeadStatus, PriorityLevel } from "@/lib/db-types";

export type AutomationTrigger =
  | "lead_created"
  | "indiamart_lead"
  | "conversation_escalated"
  | "lead_status_changed";

export type AutomationAction =
  | { type: "set_lead_priority"; priority: PriorityLevel }
  | { type: "set_lead_status"; status: LeadStatus }
  | { type: "set_follow_up_hours"; hours: number }
  | { type: "add_lead_note"; note: string }
  | { type: "tag_conversation"; tag: string }
  | { type: "set_assignee_label"; label: string }
  | { type: "add_system_message"; body: string };
