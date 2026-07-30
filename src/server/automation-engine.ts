import type { LeadStatus, PriorityLevel } from "@/lib/db-types";
import type { AutomationAction, AutomationTrigger } from "@/lib/automation-types";
import { createServiceSupabase } from "@/lib/supabase";

export type { AutomationAction, AutomationTrigger } from "@/lib/automation-types";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

export type AutomationContext = {
  leadId?: string | null;
  conversationId?: string | null;
  toStatus?: string | null;
  source?: string | null;
};

type DbAutomation = {
  id: string;
  name: string;
  trigger_type: AutomationTrigger;
  trigger_config: Record<string, unknown>;
  actions: AutomationAction[];
  run_count: number;
  success_count: number;
};

async function executeAction(
  supabase: ReturnType<typeof createServiceSupabase>,
  action: AutomationAction,
  ctx: AutomationContext,
): Promise<string> {
  switch (action.type) {
    case "set_lead_priority": {
      if (!ctx.leadId) return "skipped:set_lead_priority (no lead)";
      await supabase
        .from("leads")
        .update({ priority: action.priority, last_activity_at: new Date().toISOString() })
        .eq("id", ctx.leadId)
        .eq("org_id", ORG_ID);
      return `set_lead_priority=${action.priority}`;
    }
    case "set_lead_status": {
      if (!ctx.leadId) return "skipped:set_lead_status (no lead)";
      await supabase
        .from("leads")
        .update({ status: action.status, last_activity_at: new Date().toISOString() })
        .eq("id", ctx.leadId)
        .eq("org_id", ORG_ID);
      return `set_lead_status=${action.status}`;
    }
    case "set_follow_up_hours": {
      if (!ctx.leadId) return "skipped:set_follow_up_hours (no lead)";
      const when = new Date(Date.now() + action.hours * 60 * 60 * 1000).toISOString();
      await supabase
        .from("leads")
        .update({ next_follow_up_at: when, last_activity_at: new Date().toISOString() })
        .eq("id", ctx.leadId)
        .eq("org_id", ORG_ID);
      return `set_follow_up_hours=${action.hours}`;
    }
    case "add_lead_note": {
      if (!ctx.leadId) return "skipped:add_lead_note (no lead)";
      const { data: lead } = await supabase
        .from("leads")
        .select("metadata")
        .eq("id", ctx.leadId)
        .maybeSingle();
      const meta = (lead?.metadata && typeof lead.metadata === "object"
        ? lead.metadata
        : {}) as Record<string, unknown>;
      const prevNotes = typeof meta.notes === "string" ? meta.notes : "";
      const notes = [prevNotes, action.note].filter(Boolean).join("\n");
      await supabase
        .from("leads")
        .update({
          metadata: { ...meta, notes },
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", ctx.leadId)
        .eq("org_id", ORG_ID);
      return "add_lead_note";
    }
    case "tag_conversation": {
      if (!ctx.conversationId) return "skipped:tag_conversation (no conversation)";
      const { data: convo } = await supabase
        .from("conversations")
        .select("tags")
        .eq("id", ctx.conversationId)
        .maybeSingle();
      const tags = Array.isArray(convo?.tags) ? [...(convo!.tags as string[])] : [];
      if (!tags.includes(action.tag)) tags.push(action.tag);
      await supabase
        .from("conversations")
        .update({ tags })
        .eq("id", ctx.conversationId)
        .eq("org_id", ORG_ID);
      return `tag_conversation=${action.tag}`;
    }
    case "set_assignee_label": {
      if (!ctx.conversationId) return "skipped:set_assignee_label (no conversation)";
      await supabase
        .from("conversations")
        .update({ assignee_label: action.label })
        .eq("id", ctx.conversationId)
        .eq("org_id", ORG_ID);
      return `set_assignee_label=${action.label}`;
    }
    case "add_system_message": {
      if (!ctx.conversationId) return "skipped:add_system_message (no conversation)";
      await supabase.from("messages").insert({
        org_id: ORG_ID,
        conversation_id: ctx.conversationId,
        sender: "system",
        body: action.body,
        metadata: { automation: true },
      });
      return "add_system_message";
    }
    default:
      return "skipped:unknown_action";
  }
}

function matchesTriggerConfig(
  trigger: AutomationTrigger,
  config: Record<string, unknown>,
  ctx: AutomationContext,
): boolean {
  if (trigger === "lead_status_changed") {
    const toStatus = config.to_status;
    if (toStatus && ctx.toStatus && String(toStatus) !== String(ctx.toStatus)) {
      return false;
    }
  }
  return true;
}

/**
 * Run all Live automations for a trigger. Safe to call fire-and-forget.
 */
export async function runAutomations(
  trigger: AutomationTrigger,
  ctx: AutomationContext,
): Promise<{ ran: number; ok: number }> {
  const supabase = createServiceSupabase();
  const { data: rows, error } = await supabase
    .from("automations")
    .select("id, name, trigger_type, trigger_config, actions, run_count, success_count")
    .eq("org_id", ORG_ID)
    .eq("status", "Live")
    .eq("trigger_type", trigger);

  if (error) {
    console.error("load automations failed", error.message);
    return { ran: 0, ok: 0 };
  }

  const automations = (rows || []) as DbAutomation[];
  let ran = 0;
  let ok = 0;

  for (const auto of automations) {
    const config = (auto.trigger_config || {}) as Record<string, unknown>;
    if (!matchesTriggerConfig(trigger, config, ctx)) continue;

    ran += 1;
    const results: string[] = [];
    let failed: string | null = null;
    const actions = Array.isArray(auto.actions) ? auto.actions : [];

    try {
      for (const action of actions) {
        results.push(await executeAction(supabase, action as AutomationAction, ctx));
      }
      ok += 1;
      await supabase
        .from("automations")
        .update({
          run_count: (auto.run_count || 0) + 1,
          success_count: (auto.success_count || 0) + 1,
          last_run_at: new Date().toISOString(),
        })
        .eq("id", auto.id);
      await supabase.from("automation_runs").insert({
        org_id: ORG_ID,
        automation_id: auto.id,
        status: "success",
        trigger_type: trigger,
        input: ctx,
        output: { steps: results },
      });
    } catch (err) {
      failed = err instanceof Error ? err.message : "run failed";
      console.error(`automation ${auto.name} failed`, err);
      await supabase
        .from("automations")
        .update({
          run_count: (auto.run_count || 0) + 1,
          last_run_at: new Date().toISOString(),
        })
        .eq("id", auto.id);
      await supabase.from("automation_runs").insert({
        org_id: ORG_ID,
        automation_id: auto.id,
        status: "failed",
        trigger_type: trigger,
        input: ctx,
        output: { steps: results },
        error: failed,
      });
    }
  }

  return { ran, ok };
}

/** Non-blocking helper for call sites */
export function fireAutomations(trigger: AutomationTrigger, ctx: AutomationContext) {
  void runAutomations(trigger, ctx).catch((err) => {
    console.error("fireAutomations", err);
  });
}
