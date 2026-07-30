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

export const TRIGGER_OPTIONS: Array<{ value: AutomationTrigger; label: string }> = [
  { value: "lead_created", label: "Lead created" },
  { value: "indiamart_lead", label: "IndiaMART lead synced" },
  { value: "conversation_escalated", label: "Conversation escalated" },
  { value: "lead_status_changed", label: "Lead status changed" },
];

export const ACTION_TYPE_OPTIONS = [
  { value: "set_lead_priority", label: "Set lead priority" },
  { value: "set_lead_status", label: "Set lead status" },
  { value: "set_follow_up_hours", label: "Schedule follow-up (hours)" },
  { value: "add_lead_note", label: "Add lead note" },
  { value: "tag_conversation", label: "Tag conversation" },
  { value: "set_assignee_label", label: "Set assignee label" },
  { value: "add_system_message", label: "Post system message" },
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
        "conversation_escalated",
        "lead_status_changed",
      ]),
      leadId: z.string().uuid().optional(),
      conversationId: z.string().uuid().optional(),
      toStatus: z.string().optional(),
      source: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { runAutomations } = await import("@/server/automation-engine");
    return runAutomations(data.trigger, {
      leadId: data.leadId,
      conversationId: data.conversationId,
      toStatus: data.toStatus,
      source: data.source,
    });
  });
