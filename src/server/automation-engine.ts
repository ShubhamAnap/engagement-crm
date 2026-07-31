import type {
  AutomationAction,
  AutomationTrigger,
  AutomationTriggerConfig,
} from "@/lib/automation-types";
import { createServiceSupabase } from "@/lib/supabase";

export type { AutomationAction, AutomationTrigger } from "@/lib/automation-types";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

export type AutomationContext = {
  leadId?: string | null;
  conversationId?: string | null;
  toStatus?: string | null;
  source?: string | null;
  priority?: string | null;
  channel?: string | null;
  leadStatus?: string | null;
  phone?: string | null;
  email?: string | null;
  leadName?: string | null;
  company?: string | null;
};

function fillVars(text: string, ctx: AutomationContext): string {
  return text
    .replace(/\{\{name\}\}/gi, ctx.leadName || "Customer")
    .replace(/\{\{company\}\}/gi, ctx.company || "")
    .replace(/\{\{phone\}\}/gi, ctx.phone || "")
    .replace(/\{\{email\}\}/gi, ctx.email || "")
    .replace(/\{\{source\}\}/gi, ctx.source || "")
    .replace(/\{\{status\}\}/gi, ctx.toStatus || ctx.leadStatus || "");
}

async function enrichContext(
  supabase: ReturnType<typeof createServiceSupabase>,
  ctx: AutomationContext,
): Promise<AutomationContext> {
  const out: AutomationContext = { ...ctx };

  if (out.conversationId && !out.channel) {
    const { data: convo } = await supabase
      .from("conversations")
      .select("channel, lead_id, visitor_name, visitor_company, visitor_phone, visitor_email")
      .eq("id", out.conversationId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (convo) {
      out.channel = (convo.channel as string) || out.channel;
      if (!out.leadId && convo.lead_id) out.leadId = convo.lead_id as string;
      out.leadName = out.leadName || (convo.visitor_name as string) || null;
      out.company = out.company || (convo.visitor_company as string) || null;
      out.phone = out.phone || (convo.visitor_phone as string) || null;
      out.email = out.email || (convo.visitor_email as string) || null;
    }
  }

  if (out.leadId) {
    const { data: lead } = await supabase
      .from("leads")
      .select("name, company, phone, email, source, priority, status")
      .eq("id", out.leadId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (lead) {
      out.leadName = out.leadName || (lead.name as string) || null;
      out.company = out.company || (lead.company as string) || null;
      out.phone = out.phone || (lead.phone as string) || null;
      out.email = out.email || (lead.email as string) || null;
      out.source = out.source || (lead.source as string) || null;
      out.priority = out.priority || (lead.priority as string) || null;
      out.leadStatus = out.leadStatus || (lead.status as string) || null;
    }
  }

  return out;
}

function configMatch(expected: unknown, actual: string | null | undefined): boolean {
  if (expected == null || expected === "" || expected === "any") return true;
  if (!actual) return false;
  return String(expected).toLowerCase() === String(actual).toLowerCase();
}

function matchesTriggerConfig(
  trigger: AutomationTrigger,
  config: AutomationTriggerConfig,
  ctx: AutomationContext,
): boolean {
  if (trigger === "lead_status_changed") {
    if (!configMatch(config.to_status, ctx.toStatus)) return false;
  }
  if (!configMatch(config.source, ctx.source)) return false;
  if (!configMatch(config.priority, ctx.priority)) return false;
  if (!configMatch(config.channel, ctx.channel)) return false;
  if (!configMatch(config.lead_status, ctx.leadStatus)) return false;
  return true;
}

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
      const note = fillVars(action.note, ctx);
      const { data: lead } = await supabase
        .from("leads")
        .select("notes, metadata")
        .eq("id", ctx.leadId)
        .maybeSingle();
      const prevNotes = typeof lead?.notes === "string" ? lead.notes : "";
      const meta = (lead?.metadata && typeof lead.metadata === "object"
        ? lead.metadata
        : {}) as Record<string, unknown>;
      const metaNotes = typeof meta.notes === "string" ? meta.notes : "";
      const base = prevNotes || metaNotes;
      const notes = [base, note].filter(Boolean).join("\n");
      await supabase
        .from("leads")
        .update({
          notes,
          metadata: { ...meta, notes },
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", ctx.leadId)
        .eq("org_id", ORG_ID);
      return "add_lead_note";
    }
    case "set_sales_person": {
      if (!ctx.leadId) return "skipped:set_sales_person (no lead)";
      const salesPerson = fillVars(action.salesPerson, ctx).trim();
      await supabase
        .from("leads")
        .update({
          sales_person: salesPerson || null,
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", ctx.leadId)
        .eq("org_id", ORG_ID);
      return `set_sales_person=${salesPerson}`;
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
        body: fillVars(action.body, ctx),
        metadata: { automation: true },
      });
      return "add_system_message";
    }
    case "send_whatsapp_template": {
      const phone = ctx.phone;
      if (!phone) return "skipped:send_whatsapp_template (no phone)";
      const { sendWhatsAppTemplateMessage } = await import("@/server/whatsapp-broadcast");
      const bodyParams = (action.bodyParams || []).map((p) => fillVars(p, ctx));
      const waId = await sendWhatsAppTemplateMessage({
        toPhone: phone,
        templateName: action.templateName,
        language: action.language || "en",
        bodyParams: bodyParams.length ? bodyParams : undefined,
      });
      return `send_whatsapp_template=${action.templateName}:${waId || "ok"}`;
    }
    case "send_email": {
      const to = ctx.email;
      if (!to) return "skipped:send_email (no email)";
      const { sendEmailMessage } = await import("@/server/email-core");
      await sendEmailMessage({
        to,
        subject: fillVars(action.subject, ctx),
        text: fillVars(action.body, ctx),
      });
      return `send_email=${to}`;
    }
    case "notify_team": {
      const title = fillVars(action.title, ctx);
      const body = fillVars(action.body, ctx);
      const { error } = await supabase.from("notifications").insert({
        org_id: ORG_ID,
        title,
        body,
        href: action.href || (ctx.leadId ? "/leads" : ctx.conversationId ? "/inbox" : null),
        lead_id: ctx.leadId || null,
        conversation_id: ctx.conversationId || null,
        metadata: { automation: true },
      });
      if (error) return `skipped:notify_team (${error.message})`;
      return `notify_team=${title}`;
    }
    default:
      return "skipped:unknown_action";
  }
}

type DbAutomation = {
  id: string;
  name: string;
  description?: string | null;
  trigger_type: AutomationTrigger;
  trigger_config: Record<string, unknown>;
  actions: AutomationAction[];
  run_count: number;
  success_count: number;
  requires_approval?: boolean;
};

function actionBrief(actions: AutomationAction[]): string {
  return actions
    .map((a) => {
      switch (a.type) {
        case "send_whatsapp_template":
          return `WhatsApp:${a.templateName}`;
        case "send_email":
          return `Email:${a.subject.slice(0, 24)}`;
        case "notify_team":
          return `Notify:${a.title}`;
        case "set_follow_up_hours":
          return `Follow-up ${a.hours}h`;
        case "set_lead_priority":
          return `Priority ${a.priority}`;
        case "set_lead_status":
          return `Status ${a.status}`;
        case "set_sales_person":
          return `Sales ${a.salesPerson}`;
        default:
          return a.type;
      }
    })
    .join(" → ");
}

function buildApprovalCopy(
  auto: DbAutomation,
  trigger: AutomationTrigger,
  ctx: AutomationContext,
): { goal: string; summary: string } {
  const who = [ctx.leadName, ctx.company].filter(Boolean).join(" · ") || "Unknown contact";
  const goal =
    (auto.description && auto.description.trim()) ||
    `${auto.name} — ${trigger.replace(/_/g, " ")}`;
  const summary = [
    `Workflow: ${auto.name}`,
    `Trigger: ${trigger}`,
    `Contact: ${who}`,
    ctx.source ? `Source: ${ctx.source}` : null,
    ctx.priority ? `Priority: ${ctx.priority}` : null,
    ctx.toStatus || ctx.leadStatus ? `Status: ${ctx.toStatus || ctx.leadStatus}` : null,
    ctx.phone ? `Phone: ${ctx.phone}` : null,
    ctx.email ? `Email: ${ctx.email}` : null,
    `Actions: ${actionBrief(Array.isArray(auto.actions) ? auto.actions : []) || "—"}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { goal, summary };
}

async function enqueueApproval(
  supabase: ReturnType<typeof createServiceSupabase>,
  auto: DbAutomation,
  trigger: AutomationTrigger,
  ctx: AutomationContext,
): Promise<string> {
  // Avoid duplicate pending for same workflow + lead/conversation
  let dupQuery = supabase
    .from("automation_approvals")
    .select("id")
    .eq("org_id", ORG_ID)
    .eq("automation_id", auto.id)
    .eq("status", "pending")
    .eq("trigger_type", trigger)
    .limit(1);

  if (ctx.leadId) dupQuery = dupQuery.eq("lead_id", ctx.leadId);
  if (ctx.conversationId) dupQuery = dupQuery.eq("conversation_id", ctx.conversationId);

  const { data: existing } = await dupQuery.maybeSingle();
  if (existing?.id) return existing.id as string;

  const { goal, summary } = buildApprovalCopy(auto, trigger, ctx);
  const { data, error } = await supabase
    .from("automation_approvals")
    .insert({
      org_id: ORG_ID,
      automation_id: auto.id,
      automation_name: auto.name,
      trigger_type: trigger,
      status: "pending",
      goal,
      summary,
      context: ctx,
      actions_snapshot: auto.actions || [],
      lead_id: ctx.leadId || null,
      conversation_id: ctx.conversationId || null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id as string;
}

async function executeAutomationRow(
  supabase: ReturnType<typeof createServiceSupabase>,
  auto: DbAutomation,
  trigger: string,
  enriched: AutomationContext,
): Promise<{ ok: boolean; steps: string[]; error?: string }> {
  const results: string[] = [];
  let failed: string | null = null;
  const actions = Array.isArray(auto.actions) ? auto.actions : [];

  try {
    for (const action of actions) {
      try {
        results.push(await executeAction(supabase, action as AutomationAction, enriched));
      } catch (stepErr) {
        const msg = stepErr instanceof Error ? stepErr.message : "step failed";
        results.push(`error:${(action as AutomationAction).type}:${msg}`);
        failed = msg;
      }
    }
    if (failed) throw new Error(failed);

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
      input: enriched,
      output: { steps: results },
    });
    return { ok: true, steps: results };
  } catch (err) {
    const message = err instanceof Error ? err.message : "run failed";
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
      input: enriched,
      output: { steps: results },
      error: message,
    });
    return { ok: false, steps: results, error: message };
  }
}

/**
 * Run all Live automations for a trigger.
 * Workflows with requires_approval enqueue for human Approve/Reject instead.
 */
export async function runAutomations(
  trigger: AutomationTrigger,
  ctx: AutomationContext,
): Promise<{ ran: number; ok: number; pending: number }> {
  const supabase = createServiceSupabase();
  const enriched = await enrichContext(supabase, ctx);

  const { data: rows, error } = await supabase
    .from("automations")
    .select(
      "id, name, description, trigger_type, trigger_config, actions, run_count, success_count, requires_approval",
    )
    .eq("org_id", ORG_ID)
    .eq("status", "Live")
    .eq("trigger_type", trigger);

  if (error) {
    console.error("load automations failed", error.message);
    return { ran: 0, ok: 0, pending: 0 };
  }

  const automations = (rows || []) as DbAutomation[];
  let ran = 0;
  let ok = 0;
  let pending = 0;

  for (const auto of automations) {
    const config = (auto.trigger_config || {}) as AutomationTriggerConfig;
    if (!matchesTriggerConfig(trigger, config, enriched)) continue;

    if (auto.requires_approval !== false) {
      try {
        await enqueueApproval(supabase, auto, trigger, enriched);
        pending += 1;
        void supabase.from("notifications").insert({
          org_id: ORG_ID,
          title: "Approval needed",
          body: `${auto.name} · ${enriched.leadName || enriched.company || "campaign"}`,
          href: "/automation",
          lead_id: enriched.leadId || null,
          conversation_id: enriched.conversationId || null,
          metadata: { automation_approval: true },
        });
      } catch (err) {
        console.error("enqueue approval failed", err);
      }
      continue;
    }

    ran += 1;
    const result = await executeAutomationRow(supabase, auto, trigger, enriched);
    if (result.ok) ok += 1;
  }

  return { ran, ok, pending };
}

/** Run a single workflow immediately (Test run / after Approve) — skips approval gate. */
export async function runSingleAutomation(
  automationId: string,
  ctx: AutomationContext,
  options?: { triggerLabel?: string },
): Promise<{ ok: boolean; steps: string[]; error?: string }> {
  const supabase = createServiceSupabase();
  const enriched = await enrichContext(supabase, ctx);

  const { data: auto, error } = await supabase
    .from("automations")
    .select(
      "id, name, description, trigger_type, trigger_config, actions, run_count, success_count, requires_approval",
    )
    .eq("id", automationId)
    .eq("org_id", ORG_ID)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!auto) throw new Error("Workflow not found");

  const row = auto as DbAutomation;
  return executeAutomationRow(
    supabase,
    row,
    options?.triggerLabel || `${row.trigger_type}:manual`,
    enriched,
  );
}

export async function approveAutomationApproval(
  approvalId: string,
  resolvedBy?: string | null,
): Promise<{ ok: boolean; steps: string[]; error?: string }> {
  const supabase = createServiceSupabase();
  const { data: row, error } = await supabase
    .from("automation_approvals")
    .select("*")
    .eq("id", approvalId)
    .eq("org_id", ORG_ID)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) throw new Error("Approval not found");
  if (row.status !== "pending") throw new Error(`Already ${row.status}`);

  const ctx = (row.context || {}) as AutomationContext;
  const result = await runSingleAutomation(row.automation_id as string, ctx, {
    triggerLabel: `${row.trigger_type}:approved`,
  });

  await supabase
    .from("automation_approvals")
    .update({
      status: result.ok ? "approved" : "approved",
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy || null,
    })
    .eq("id", approvalId);

  if (!result.ok) {
    // Still mark approved (user chose to run); failure is in run log
    return result;
  }
  return result;
}

export async function rejectAutomationApproval(
  approvalId: string,
  resolvedBy?: string | null,
): Promise<void> {
  const supabase = createServiceSupabase();
  const { data: row, error } = await supabase
    .from("automation_approvals")
    .select("id, status")
    .eq("id", approvalId)
    .eq("org_id", ORG_ID)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) throw new Error("Approval not found");
  if (row.status !== "pending") throw new Error(`Already ${row.status}`);

  await supabase
    .from("automation_approvals")
    .update({
      status: "rejected",
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy || null,
    })
    .eq("id", approvalId);
}

/** Approve many pending campaigns (e.g. IndiaMART sync batch). */
export async function bulkApproveAutomationApprovals(
  approvalIds: string[] | "all",
  resolvedBy?: string | null,
): Promise<{ approved: number; failed: number; errors: string[] }> {
  const supabase = createServiceSupabase();
  let ids = approvalIds;

  if (ids === "all") {
    const { data, error } = await supabase
      .from("automation_approvals")
      .select("id")
      .eq("org_id", ORG_ID)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw new Error(error.message);
    ids = (data || []).map((r) => r.id as string);
  }

  let approved = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const id of ids) {
    try {
      const result = await approveAutomationApproval(id, resolvedBy);
      if (result.ok) approved += 1;
      else {
        approved += 1; // still executed; count as approved with note
        if (result.error) errors.push(result.error);
      }
    } catch (err) {
      failed += 1;
      errors.push(err instanceof Error ? err.message : "approve failed");
    }
  }

  return { approved, failed, errors };
}

/** Reject many pending campaigns in one action. */
export async function bulkRejectAutomationApprovals(
  approvalIds: string[] | "all",
  resolvedBy?: string | null,
): Promise<{ rejected: number; failed: number; errors: string[] }> {
  const supabase = createServiceSupabase();
  let ids = approvalIds;

  if (ids === "all") {
    const { data, error } = await supabase
      .from("automation_approvals")
      .select("id")
      .eq("org_id", ORG_ID)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw new Error(error.message);
    ids = (data || []).map((r) => r.id as string);
  }

  let rejected = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const id of ids) {
    try {
      await rejectAutomationApproval(id, resolvedBy);
      rejected += 1;
    } catch (err) {
      failed += 1;
      errors.push(err instanceof Error ? err.message : "reject failed");
    }
  }

  return { rejected, failed, errors };
}

/**
 * Find leads past next_follow_up_at, fire follow_up_due, clear the due timestamp.
 */
export async function processDueFollowUps(limit = 40): Promise<{
  processed: number;
  ran: number;
  ok: number;
  pending: number;
}> {
  const supabase = createServiceSupabase();
  const now = new Date().toISOString();

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, name, company, phone, email, source, priority, status")
    .eq("org_id", ORG_ID)
    .not("status", "in", "(Won,Lost)")
    .lte("next_follow_up_at", now)
    .not("next_follow_up_at", "is", null)
    .order("next_follow_up_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("processDueFollowUps", error.message);
    return { processed: 0, ran: 0, ok: 0, pending: 0 };
  }

  let ran = 0;
  let ok = 0;
  let pending = 0;
  const rows = leads || [];

  for (const lead of rows) {
    const { data: full } = await supabase
      .from("leads")
      .select("metadata")
      .eq("id", lead.id)
      .maybeSingle();
    const meta = (full?.metadata && typeof full.metadata === "object"
      ? full.metadata
      : {}) as Record<string, unknown>;

    // Clear due date first so retries don't double-fire
    await supabase
      .from("leads")
      .update({
        next_follow_up_at: null,
        last_activity_at: now,
        metadata: { ...meta, last_follow_up_fired_at: now },
      })
      .eq("id", lead.id);

    const result = await runAutomations("follow_up_due", {
      leadId: lead.id as string,
      source: lead.source as string,
      priority: lead.priority as string,
      leadStatus: lead.status as string,
      phone: lead.phone as string,
      email: lead.email as string,
      leadName: lead.name as string,
      company: lead.company as string,
    });
    ran += result.ran;
    ok += result.ok;
    pending += result.pending;
  }

  return { processed: rows.length, ran, ok, pending };
}

/** Non-blocking helper for call sites */
export function fireAutomations(trigger: AutomationTrigger, ctx: AutomationContext) {
  void runAutomations(trigger, ctx).catch((err) => {
    console.error("fireAutomations", err);
  });
}
