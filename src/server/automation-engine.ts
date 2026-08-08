import type {
  AutomationAction,
  AutomationConditionField,
  AutomationConditionOp,
  AutomationLeafAction,
  AutomationTrigger,
  AutomationTriggerConfig,
  AutomationWaitUnit,
} from "@/lib/automation-types";
import { triggerFilterMatches } from "@/lib/automation-types";
import { createServiceSupabase } from "@/lib/supabase";
import { normalizeWhatsAppDigits } from "@/lib/whatsapp-window";

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
  salesPerson?: string | null;
  requirement?: string | null;
  location?: string | null;
  notes?: string | null;
};

function fillVars(text: string, ctx: AutomationContext): string {
  return text
    .replace(/\{\{name\}\}/gi, ctx.leadName || "Customer")
    .replace(/\{\{first_name\}\}/gi, (ctx.leadName || "Customer").split(/\s+/)[0] || "Customer")
    .replace(/\{\{company\}\}/gi, ctx.company || "")
    .replace(/\{\{phone\}\}/gi, ctx.phone || "")
    .replace(/\{\{email\}\}/gi, ctx.email || "")
    .replace(/\{\{source\}\}/gi, ctx.source || "")
    .replace(/\{\{status\}\}/gi, ctx.toStatus || ctx.leadStatus || "")
    .replace(/\{\{sales_person\}\}/gi, ctx.salesPerson || "")
    .replace(/\{\{salesperson\}\}/gi, ctx.salesPerson || "")
    .replace(/\{\{requirement\}\}/gi, ctx.requirement || "")
    .replace(/\{\{location\}\}/gi, ctx.location || "")
    .replace(/\{\{notes\}\}/gi, ctx.notes || "");
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
      .select(
        "name, company, phone, email, source, priority, status, sales_person, requirement, location, notes",
      )
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
      out.salesPerson = out.salesPerson || (lead.sales_person as string) || null;
      out.requirement = out.requirement || (lead.requirement as string) || null;
      out.location = out.location || (lead.location as string) || null;
      out.notes = out.notes || (lead.notes as string) || null;
    }
  }

  if (out.phone) {
    out.phone = normalizeWhatsAppDigits(out.phone) || out.phone;
  }

  return out;
}

function conditionFieldValue(field: AutomationConditionField, ctx: AutomationContext): string {
  switch (field) {
    case "lead_status":
      return (ctx.toStatus || ctx.leadStatus || "").trim();
    case "priority":
      return (ctx.priority || "").trim();
    case "source":
      return (ctx.source || "").trim();
    case "channel":
      return (ctx.channel || "").trim();
    case "has_phone":
      return ctx.phone?.trim() ? "yes" : "";
    case "has_email":
      return ctx.email?.trim() ? "yes" : "";
    case "sales_person":
      return (ctx.salesPerson || "").trim();
    default:
      return "";
  }
}

function evaluateCondition(
  field: AutomationConditionField,
  op: AutomationConditionOp,
  value: string | undefined,
  ctx: AutomationContext,
): boolean {
  const actual = conditionFieldValue(field, ctx);
  const expected = (value || "").trim();

  switch (op) {
    case "is_set":
      return Boolean(actual);
    case "is_empty":
      return !actual;
    case "eq":
      return actual.toLowerCase() === expected.toLowerCase();
    case "neq":
      return actual.toLowerCase() !== expected.toLowerCase();
    case "contains":
      return actual.toLowerCase().includes(expected.toLowerCase());
    default:
      return false;
  }
}

function waitMs(amount: number, unit: AutomationWaitUnit): number {
  const n = Math.max(1, Number(amount) || 1);
  if (unit === "days") return n * 24 * 60 * 60 * 1000;
  if (unit === "hours") return n * 60 * 60 * 1000;
  return n * 60 * 1000;
}

async function scheduleRemainingActions(
  supabase: ReturnType<typeof createServiceSupabase>,
  opts: {
    automationId: string;
    automationName: string;
    ctx: AutomationContext;
    remaining: AutomationAction[];
    amount: number;
    unit: AutomationWaitUnit;
  },
): Promise<string> {
  const runAt = new Date(Date.now() + waitMs(opts.amount, opts.unit)).toISOString();
  const { data, error } = await supabase
    .from("automation_scheduled_steps")
    .insert({
      org_id: ORG_ID,
      automation_id: opts.automationId,
      automation_name: opts.automationName,
      lead_id: opts.ctx.leadId || null,
      conversation_id: opts.ctx.conversationId || null,
      context: opts.ctx,
      remaining_actions: opts.remaining,
      run_at: runAt,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    // Table may not exist yet — fail clearly
    throw new Error(
      error.message.includes("automation_scheduled_steps")
        ? "Wait requires migration 016_automation_wait_branch.sql"
        : error.message,
    );
  }
  return `${runAt}:${data.id as string}`;
}

type SequenceResult = { steps: string[]; paused: boolean };

/**
 * Run actions in order. Wait pauses and schedules the rest (plus parent continuation).
 * If/Else picks Yes/No branch; wait inside a branch also continues the parent after the branch.
 */
async function runActionSequence(
  supabase: ReturnType<typeof createServiceSupabase>,
  actions: AutomationAction[],
  ctx: AutomationContext,
  meta: { automationId: string; automationName: string },
  continuation: AutomationAction[] = [],
): Promise<SequenceResult> {
  const steps: string[] = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

    if (action.type === "wait") {
      const remaining = [...actions.slice(i + 1), ...continuation];
      const scheduled = await scheduleRemainingActions(supabase, {
        automationId: meta.automationId,
        automationName: meta.automationName,
        ctx,
        remaining,
        amount: action.amount,
        unit: action.unit,
      });
      steps.push(`wait:${action.amount}${action.unit}->${scheduled}`);
      return { steps, paused: true };
    }

    if (action.type === "if_else") {
      const pass = evaluateCondition(action.field, action.op, action.value, ctx);
      const branch = (pass ? action.thenActions : action.elseActions) || [];
      steps.push(
        `if_else:${action.field}:${action.op}:${action.value || ""}→${pass ? "yes" : "no"}`,
      );
      const parentAfter = [...actions.slice(i + 1), ...continuation];
      const sub = await runActionSequence(
        supabase,
        branch as AutomationAction[],
        ctx,
        meta,
        parentAfter,
      );
      steps.push(...sub.steps);
      if (sub.paused) return { steps, paused: true };
      continue;
    }

    try {
      steps.push(await executeLeafAction(supabase, action, ctx));
    } catch (stepErr) {
      const msg = stepErr instanceof Error ? stepErr.message : "step failed";
      steps.push(`error:${action.type}:${msg}`);
      throw new Error(msg);
    }
  }

  return { steps, paused: false };
}

function matchesTriggerConfig(
  trigger: AutomationTrigger,
  config: AutomationTriggerConfig,
  ctx: AutomationContext,
): boolean {
  if (trigger === "lead_status_changed") {
    if (!triggerFilterMatches(config.to_status, ctx.toStatus)) return false;
  }
  if (!triggerFilterMatches(config.source, ctx.source)) return false;
  if (!triggerFilterMatches(config.priority, ctx.priority)) return false;
  // Website / Brainmine CRM sync don't carry a chat channel — don't let WhatsApp-only filter block WA templates
  if (trigger !== "website_visitor_captured" && trigger !== "brainmine_lead") {
    if (!triggerFilterMatches(config.channel, ctx.channel)) return false;
  }
  if (!triggerFilterMatches(config.lead_status, ctx.leadStatus)) return false;
  return true;
}

async function executeLeafAction(
  supabase: ReturnType<typeof createServiceSupabase>,
  action: AutomationLeafAction,
  ctx: AutomationContext,
): Promise<string> {
  switch (action.type) {
    case "wait":
      return "skipped:wait (use sequence runner)";
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
      const { normalizeWhatsAppDigits } = await import("@/lib/whatsapp-window");
      const { data: directoryRows } = await supabase
        .from("sales_person_directory")
        .select("email, display_name, mobile, is_active")
        .eq("org_id", ORG_ID)
        .eq("is_active", true);
      const fields = {
        name: ctx.leadName,
        company: ctx.company,
        email: ctx.email,
        phone: ctx.phone,
        requirement: ctx.requirement,
        sales_person: ctx.salesPerson,
        location: ctx.location,
        source: ctx.source,
        status: ctx.toStatus || ctx.leadStatus,
        notes: ctx.notes,
      };
      const { applySalesPersonDirectory, resolveWaBodyParams, parseStoredBindings } = await import(
        "@/lib/wa-template-merge"
      );
      const merged = applySalesPersonDirectory(fields, directoryRows || []);
      const toSource = action.toPhoneSource || "phone";
      const phoneRaw =
        toSource === "sales_person_mobile"
          ? merged.sales_person_mobile || null
          : merged.phone || ctx.phone || null;
      const phone = normalizeWhatsAppDigits(phoneRaw);
      if (!phone) {
        return `skipped:send_whatsapp_template (no phone from ${toSource})`;
      }
      const { sendWhatsAppTemplateMessage } = await import("@/server/whatsapp-broadcast");
      let bodyParams: string[] = [];
      if (action.bodyParamBindings && action.bodyParamBindings.length > 0) {
        const bindings = parseStoredBindings(action.bodyParamBindings, []);
        bodyParams = resolveWaBodyParams(bindings, fields, directoryRows || []);
      } else {
        const ctxResolved = { ...ctx, salesPerson: merged.sales_person };
        bodyParams = (action.bodyParams || []).map((p) => fillVars(p, ctxResolved));
      }
      const waId = await sendWhatsAppTemplateMessage({
        toPhone: phone,
        templateName: action.templateName,
        language: action.language || "en",
        bodyParams: bodyParams.length ? bodyParams : undefined,
      });
      return `send_whatsapp_template=${action.templateName}:${waId || "ok"}→${phone}`;
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
        case "wait":
          return `Wait ${a.amount}${a.unit[0]}`;
        case "if_else":
          return `If ${a.field} ${a.op}${a.value ? ` ${a.value}` : ""}`;
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
): Promise<{ ok: boolean; steps: string[]; error?: string; paused?: boolean }> {
  const actions = Array.isArray(auto.actions) ? auto.actions : [];
  let results: string[] = [];

  try {
    const seq = await runActionSequence(supabase, actions, enriched, {
      automationId: auto.id,
      automationName: auto.name,
    });
    results = seq.steps;

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
      status: seq.paused ? "scheduled" : "success",
      trigger_type: trigger,
      input: enriched,
      output: { steps: results, paused: seq.paused },
    });
    return { ok: true, steps: results, paused: seq.paused };
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
    if (!matchesTriggerConfig(trigger, config, enriched)) {
      console.info("automation skipped (trigger filters)", {
        name: auto.name,
        trigger,
        channel: enriched.channel,
        source: enriched.source,
        config,
      });
      continue;
    }

    // Website welcome + Brainmine new lead: send immediately when Live (don't queue for Approve)
    const needsApproval =
      trigger !== "website_visitor_captured" &&
      trigger !== "brainmine_lead" &&
      auto.requires_approval !== false;

    if (needsApproval) {
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

/**
 * Run a workflow action list against one lead (used by daily Follow-up Agent batch).
 */
export async function runActionSequenceForLead(
  leadId: string,
  actions: AutomationAction[],
  meta: { automationId: string; automationName: string },
): Promise<{ steps: string[]; paused?: boolean }> {
  const supabase = createServiceSupabase();
  const enriched = await enrichContext(supabase, { leadId });
  return runActionSequence(supabase, actions, enriched, meta);
}

export async function approveAutomationApproval(
  approvalId: string,
  resolvedBy?: string | null,
): Promise<{ ok: boolean; steps: string[]; error?: string }> {
  const supabase = createServiceSupabase();

  // Atomic soft-claim (pending + resolved_at IS NULL → stamp resolved_at)
  const { data: claimedRows, error: claimErr } = await supabase.rpc("claim_automation_approval", {
    p_approval_id: approvalId,
    p_resolved_by: resolvedBy || null,
  });
  if (claimErr) {
    // Fallback if migration 030 not applied yet
    console.warn("claim_automation_approval unavailable:", claimErr.message);
    const { data: row, error } = await supabase
      .from("automation_approvals")
      .select("*")
      .eq("id", approvalId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Approval not found");
    if (row.status !== "pending") throw new Error(`Already ${row.status}`);
    return finishApproval(supabase, row, resolvedBy);
  }

  const row = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows;
  if (!row) throw new Error("Approval not found or already claimed");
  if ((row as { org_id?: string }).org_id && (row as { org_id: string }).org_id !== ORG_ID) {
    throw new Error("Approval not found");
  }

  try {
    return await finishApproval(supabase, row as Record<string, unknown>, resolvedBy);
  } catch (err) {
    // Release soft-claim so a human can retry
    await supabase
      .from("automation_approvals")
      .update({ resolved_at: null, resolved_by: null })
      .eq("id", approvalId)
      .eq("status", "pending");
    throw err;
  }
}

async function finishApproval(
  supabase: ReturnType<typeof createServiceSupabase>,
  row: Record<string, unknown>,
  resolvedBy?: string | null,
): Promise<{ ok: boolean; steps: string[]; error?: string }> {
  const ctx = (row.context || {}) as AutomationContext & {
    mode?: string;
    leadIds?: string[];
  };

  if (ctx.mode === "daily_followup_batch" || row.trigger_type === "daily_followup") {
    const { executeDailyFollowUpBatch } = await import("@/server/followup-agent");
    const batch = await executeDailyFollowUpBatch(row.id as string, resolvedBy, {
      alreadyClaimed: true,
      row,
    });
    return { ok: batch.ok, steps: batch.steps, error: batch.error };
  }

  const result = await runSingleAutomation(row.automation_id as string, ctx, {
    triggerLabel: `${row.trigger_type}:approved`,
  });

  await supabase
    .from("automation_approvals")
    .update({
      status: "approved",
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy || null,
    })
    .eq("id", row.id as string);

  return result;
}

export async function rejectAutomationApproval(
  approvalId: string,
  resolvedBy?: string | null,
): Promise<void> {
  const supabase = createServiceSupabase();

  const { data: claimedRows, error: claimErr } = await supabase.rpc("claim_automation_approval", {
    p_approval_id: approvalId,
    p_resolved_by: resolvedBy || null,
  });

  if (claimErr) {
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
    return;
  }

  const row = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows;
  if (!row) throw new Error("Approval not found or already claimed");

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

  const { data: claimed, error: claimErr } = await supabase.rpc("claim_due_follow_up_leads", {
    p_org_id: ORG_ID,
    p_limit: limit,
  });

  let rows: Array<{
    id: string;
    name: string | null;
    company: string | null;
    phone: string | null;
    email: string | null;
    source: string | null;
    priority: string | null;
    status: string | null;
  }> = [];

  if (claimErr) {
    console.warn("claim_due_follow_up_leads unavailable:", claimErr.message);
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
    rows = (leads || []) as typeof rows;

    for (const lead of rows) {
      const { data: full } = await supabase
        .from("leads")
        .select("metadata")
        .eq("id", lead.id)
        .maybeSingle();
      const meta = (full?.metadata && typeof full.metadata === "object"
        ? full.metadata
        : {}) as Record<string, unknown>;
      await supabase
        .from("leads")
        .update({
          next_follow_up_at: null,
          last_activity_at: now,
          metadata: { ...meta, last_follow_up_fired_at: now },
        })
        .eq("id", lead.id);
    }
  } else {
    rows = (claimed || []) as typeof rows;
  }

  let ran = 0;
  let ok = 0;
  let pending = 0;

  for (const lead of rows) {
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

/**
 * Resume workflows paused on Wait nodes (cron every 1–5 min).
 */
export async function processScheduledAutomationSteps(limit = 40): Promise<{
  processed: number;
  ok: number;
  failed: number;
  paused: number;
}> {
  const supabase = createServiceSupabase();
  const now = new Date().toISOString();

  const { data: claimed, error: claimErr } = await supabase.rpc(
    "claim_scheduled_automation_steps",
    {
      p_org_id: ORG_ID,
      p_limit: limit,
    },
  );

  let list: Array<{
    id: string;
    automation_id: string;
    automation_name: string | null;
    lead_id: string | null;
    conversation_id: string | null;
    context: unknown;
    remaining_actions: unknown;
  }> = [];

  if (claimErr) {
    if (claimErr.message.includes("automation_scheduled_steps")) {
      return { processed: 0, ok: 0, failed: 0, paused: 0 };
    }
    console.warn("claim_scheduled_automation_steps unavailable:", claimErr.message);
    const { data: rows, error } = await supabase
      .from("automation_scheduled_steps")
      .select(
        "id, automation_id, automation_name, lead_id, conversation_id, context, remaining_actions",
      )
      .eq("org_id", ORG_ID)
      .eq("status", "pending")
      .lte("run_at", now)
      .order("run_at", { ascending: true })
      .limit(limit);

    if (error) {
      if (error.message.includes("automation_scheduled_steps")) {
        return { processed: 0, ok: 0, failed: 0, paused: 0 };
      }
      console.error("processScheduledAutomationSteps", error.message);
      return { processed: 0, ok: 0, failed: 0, paused: 0 };
    }
    list = (rows || []) as typeof list;
    for (const row of list) {
      await supabase
        .from("automation_scheduled_steps")
        .update({ status: "running", updated_at: now })
        .eq("id", row.id)
        .eq("status", "pending");
    }
  } else {
    list = (claimed || []) as typeof list;
  }

  let ok = 0;
  let failed = 0;
  let paused = 0;

  for (const row of list) {

    const ctx = await enrichContext(supabase, {
      ...((row.context && typeof row.context === "object" ? row.context : {}) as AutomationContext),
      leadId: (row.lead_id as string) || undefined,
      conversationId: (row.conversation_id as string) || undefined,
    });
    const remaining = Array.isArray(row.remaining_actions)
      ? (row.remaining_actions as AutomationAction[])
      : [];

    try {
      const seq = await runActionSequence(
        supabase,
        remaining,
        ctx,
        {
          automationId: row.automation_id as string,
          automationName: (row.automation_name as string) || "Automation",
        },
      );

      await supabase.from("automation_runs").insert({
        org_id: ORG_ID,
        automation_id: row.automation_id,
        status: seq.paused ? "scheduled" : "success",
        trigger_type: "wait_resume",
        input: ctx,
        output: { steps: seq.steps, paused: seq.paused, scheduled_step_id: row.id },
      });

      await supabase
        .from("automation_scheduled_steps")
        .update({
          status: "done",
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);

      if (seq.paused) paused += 1;
      else ok += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "resume failed";
      failed += 1;
      await supabase
        .from("automation_scheduled_steps")
        .update({
          status: "error",
          last_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      await supabase.from("automation_runs").insert({
        org_id: ORG_ID,
        automation_id: row.automation_id,
        status: "failed",
        trigger_type: "wait_resume",
        input: ctx,
        output: {},
        error: message,
      });
    }
  }

  return { processed: list.length, ok, failed, paused };
}

/** Non-blocking helper for call sites */
export function fireAutomations(trigger: AutomationTrigger, ctx: AutomationContext) {
  void runAutomations(trigger, ctx).catch((err) => {
    console.error("fireAutomations", err);
  });
}
