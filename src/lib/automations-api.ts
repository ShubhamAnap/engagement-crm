import type { AutomationAction, AutomationTrigger } from "@/lib/automation-types";
import { getBrowserSupabase } from "@/lib/supabase";
import { ENERTECH_ORG_ID } from "@/lib/chat-api";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type { AutomationAction, AutomationTrigger } from "@/lib/automation-types";

export type AutomationStatus = "Live" | "Paused" | "Draft";

export type DbAutomation = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  status: AutomationStatus;
  trigger_type: AutomationTrigger;
  trigger_config: Record<string, unknown>;
  actions: AutomationAction[];
  run_count: number;
  success_count: number;
  last_run_at: string | null;
  requires_approval: boolean;
  created_at: string;
  updated_at: string;
};

export type DbAutomationRun = {
  id: string;
  org_id: string;
  automation_id: string;
  status: string;
  trigger_type: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  created_at: string;
};

export type DbAutomationApproval = {
  id: string;
  org_id: string;
  automation_id: string;
  automation_name: string;
  trigger_type: string;
  status: "pending" | "approved" | "rejected" | "expired";
  goal: string;
  summary: string;
  context: Record<string, unknown>;
  actions_snapshot: AutomationAction[];
  lead_id: string | null;
  conversation_id: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

export const TRIGGER_OPTIONS: Array<{ value: AutomationTrigger; label: string }> = [
  { value: "lead_created", label: "Lead created" },
  { value: "indiamart_lead", label: "IndiaMART lead synced" },
  { value: "tradeindia_lead", label: "TradeIndia lead synced" },
  { value: "conversation_escalated", label: "Conversation escalated" },
  { value: "lead_status_changed", label: "Lead status changed" },
  { value: "follow_up_due", label: "Follow-up due (scheduled)" },
];

export const ACTION_TYPE_OPTIONS = [
  { value: "wait", label: "Wait (delay)" },
  { value: "if_else", label: "If / Else (branch)" },
  { value: "set_lead_priority", label: "Set lead priority" },
  { value: "set_lead_status", label: "Set lead status" },
  { value: "set_follow_up_hours", label: "Schedule follow-up (hours)" },
  { value: "add_lead_note", label: "Add lead note" },
  { value: "set_sales_person", label: "Assign sales person" },
  { value: "tag_conversation", label: "Tag conversation" },
  { value: "set_assignee_label", label: "Set assignee label" },
  { value: "add_system_message", label: "Post system message" },
  { value: "send_whatsapp_template", label: "Send WhatsApp template" },
  { value: "send_email", label: "Send email" },
  { value: "notify_team", label: "Notify team (in-app)" },
] as const;

export const LEAF_ACTION_TYPE_OPTIONS = ACTION_TYPE_OPTIONS.filter(
  (o) => o.value !== "if_else",
);

export const CONDITION_FIELD_OPTIONS = [
  { value: "lead_status", label: "Lead status" },
  { value: "priority", label: "Priority" },
  { value: "source", label: "Source" },
  { value: "channel", label: "Channel" },
  { value: "has_phone", label: "Has phone" },
  { value: "has_email", label: "Has email" },
  { value: "sales_person", label: "Sales person" },
] as const;

export const CONDITION_OP_OPTIONS = [
  { value: "eq", label: "Equals" },
  { value: "neq", label: "Not equals" },
  { value: "contains", label: "Contains" },
  { value: "is_set", label: "Is set" },
  { value: "is_empty", label: "Is empty" },
] as const;

export function successRate(a: DbAutomation): number {
  if (!a.run_count) return 0;
  return Math.round((a.success_count / a.run_count) * 1000) / 10;
}

export async function listAutomations(orgId: string = ENERTECH_ORG_ID): Promise<DbAutomation[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("automations")
    .select("*")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...(row as DbAutomation),
    actions: Array.isArray(row.actions) ? (row.actions as AutomationAction[]) : [],
    trigger_config: (row.trigger_config || {}) as Record<string, unknown>,
    requires_approval: row.requires_approval !== false,
  }));
}

export async function listAutomationRuns(
  automationId: string,
  limit = 20,
): Promise<DbAutomationRun[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("automation_runs")
    .select("*")
    .eq("automation_id", automationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as DbAutomationRun[];
}

export type AutomationInput = {
  name: string;
  description?: string;
  status: AutomationStatus;
  triggerType: AutomationTrigger;
  triggerConfig?: Record<string, unknown>;
  actions: AutomationAction[];
  requiresApproval?: boolean;
};

export async function createAutomation(
  orgId: string,
  input: AutomationInput,
): Promise<DbAutomation> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("automations")
    .insert({
      org_id: orgId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: input.status,
      trigger_type: input.triggerType,
      trigger_config: input.triggerConfig || {},
      actions: input.actions,
      requires_approval: input.requiresApproval !== false,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DbAutomation;
}

export async function updateAutomation(
  automationId: string,
  input: AutomationInput,
): Promise<DbAutomation> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("automations")
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: input.status,
      trigger_type: input.triggerType,
      trigger_config: input.triggerConfig || {},
      actions: input.actions,
      requires_approval: input.requiresApproval !== false,
    })
    .eq("id", automationId)
    .select("*")
    .single();
  if (error) throw error;
  return data as DbAutomation;
}

export async function setAutomationStatus(
  automationId: string,
  status: AutomationStatus,
): Promise<DbAutomation> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("automations")
    .update({ status })
    .eq("id", automationId)
    .select("*")
    .single();
  if (error) throw error;
  return data as DbAutomation;
}

export async function deleteAutomation(automationId: string): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await supabase.from("automations").delete().eq("id", automationId);
  if (error) throw error;
}

/** Client-callable trigger (e.g. after creating a lead in the browser). */
export const fireAutomationTrigger = createServerFn({ method: "POST" })
  .validator(
    z.object({
      trigger: z.enum([
        "lead_created",
        "indiamart_lead",
        "tradeindia_lead",
        "conversation_escalated",
        "lead_status_changed",
        "follow_up_due",
      ]),
      leadId: z.string().uuid().optional(),
      conversationId: z.string().uuid().optional(),
      toStatus: z.string().optional(),
      source: z.string().optional(),
      priority: z.string().optional(),
      channel: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { runAutomations } = await import("@/server/automation-engine");
    return runAutomations(data.trigger, {
      leadId: data.leadId,
      conversationId: data.conversationId,
      toStatus: data.toStatus,
      source: data.source,
      priority: data.priority,
      channel: data.channel,
    });
  });

/** Test-run one workflow against an optional lead / conversation. */
export const testAutomationRun = createServerFn({ method: "POST" })
  .validator(
    z.object({
      automationId: z.string().uuid(),
      leadId: z.string().uuid().optional(),
      conversationId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { createServiceSupabase } = await import("@/lib/supabase");
    const { runSingleAutomation } = await import("@/server/automation-engine");
    const supabase = createServiceSupabase();

    let leadId = data.leadId;
    let conversationId = data.conversationId;

    if (!leadId && !conversationId) {
      const { data: lead } = await supabase
        .from("leads")
        .select("id")
        .eq("org_id", ENERTECH_ORG_ID)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      leadId = (lead?.id as string) || undefined;
    }

    if (!leadId && !conversationId) {
      throw new Error("No lead found to test against — create a lead first");
    }

    return runSingleAutomation(data.automationId, { leadId, conversationId });
  });

/** Process leads whose next_follow_up_at is past (also called by cron). */
export const processDueFollowUpsFn = createServerFn({ method: "POST" }).handler(async () => {
  const { processDueFollowUps, processScheduledAutomationSteps } = await import(
    "@/server/automation-engine"
  );
  const [followUps, waits] = await Promise.all([
    processDueFollowUps(),
    processScheduledAutomationSteps(),
  ]);
  return { ...followUps, waits };
});

export async function listPendingApprovals(
  orgId: string = ENERTECH_ORG_ID,
): Promise<DbAutomationApproval[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("automation_approvals")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    // Migration not applied yet
    console.warn("[approvals]", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    ...(row as DbAutomationApproval),
    actions_snapshot: Array.isArray(row.actions_snapshot)
      ? (row.actions_snapshot as AutomationAction[])
      : [],
    context: (row.context || {}) as Record<string, unknown>,
  }));
}

export const approveAutomationApprovalFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      approvalId: z.string().uuid(),
      resolvedBy: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { approveAutomationApproval } = await import("@/server/automation-engine");
    return approveAutomationApproval(data.approvalId, data.resolvedBy);
  });

export const rejectAutomationApprovalFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      approvalId: z.string().uuid(),
      resolvedBy: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { rejectAutomationApproval } = await import("@/server/automation-engine");
    await rejectAutomationApproval(data.approvalId, data.resolvedBy);
    return { ok: true };
  });

export const bulkApproveAutomationApprovalsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      resolvedBy: z.string().uuid().optional(),
      approvalIds: z.array(z.string().uuid()).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { bulkApproveAutomationApprovals } = await import("@/server/automation-engine");
    return bulkApproveAutomationApprovals(data.approvalIds ?? "all", data.resolvedBy);
  });

export const bulkRejectAutomationApprovalsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      resolvedBy: z.string().uuid().optional(),
      approvalIds: z.array(z.string().uuid()).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { bulkRejectAutomationApprovals } = await import("@/server/automation-engine");
    return bulkRejectAutomationApprovals(data.approvalIds ?? "all", data.resolvedBy);
  });
