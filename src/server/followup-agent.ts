/**
 * Follow-up Agent — daily campaign proposals.
 *
 * The /agents "followup" row is only a chat specialist. Real daily work lives here:
 * cron (or manual) picks open leads → one approval → on Approve, WhatsApp/email each lead.
 */
import { createServiceSupabase } from "@/lib/supabase";
import type { AutomationAction, AutomationLeafAction } from "@/lib/automation-types";
import type { AutomationContext } from "@/server/automation-engine";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const DAILY_AUTO_NAME = "Follow-up Agent · Daily campaign";
const DAILY_TRIGGER = "daily_followup";
const MAX_AUDIENCE = 40;

export type DailyFollowUpProposalResult = {
  skipped?: string;
  approvalId?: string;
  leadCount?: number;
  leadNames?: string[];
  hasWhatsAppTemplate?: boolean;
};

function todayKey(d = new Date()): string {
  // IST calendar day for EnerTech ops
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

async function resolveFollowUpTemplate(
  supabase: ReturnType<typeof createServiceSupabase>,
): Promise<{ name: string; language: string } | null> {
  const envName = (process.env.FOLLOWUP_WA_TEMPLATE_NAME || "").trim();
  if (envName) {
    return {
      name: envName,
      language: (process.env.FOLLOWUP_WA_TEMPLATE_LANG || "en").trim() || "en",
    };
  }

  const { data } = await supabase
    .from("wa_message_templates")
    .select("name, language, status")
    .eq("org_id", ORG_ID)
    .order("updated_at", { ascending: false })
    .limit(40);

  const rows = (data || []) as Array<{ name: string; language?: string; status?: string }>;
  const approved = rows.filter((t) => /approved/i.test(String(t.status || "")));
  const pool = approved.length ? approved : rows;
  const hit =
    pool.find((t) => /follow/i.test(t.name)) ||
    pool.find((t) => /hello|enquiry|thank/i.test(t.name)) ||
    pool[0];
  if (!hit?.name) return null;
  return { name: hit.name, language: hit.language || "en" };
}

async function ensureDailyFollowUpAutomation(
  supabase: ReturnType<typeof createServiceSupabase>,
  template: { name: string; language: string } | null,
): Promise<{ id: string; name: string; actions: AutomationAction[]; status: string }> {
  const actions: AutomationLeafAction[] = [];
  if (template) {
    actions.push({
      type: "send_whatsapp_template",
      templateName: template.name,
      language: template.language,
      bodyParamBindings: [
        { source: "first_name" },
        { source: "requirement" },
        { source: "sales_person" },
      ],
    });
  } else {
    actions.push({
      type: "send_email",
      subject: "EnerTech follow-up — {{name}}",
      body: "Hello {{name}},\n\nJust following up on your enquiry{{requirement}} with EnerTech UPS. Reply to this email or WhatsApp us when convenient.\n\nRegards,\nEnerTech",
    });
  }
  actions.push({ type: "set_follow_up_hours", hours: 48 });
  actions.push({
    type: "add_lead_note",
    note: `[${new Date().toISOString().slice(0, 10)}] Daily follow-up campaign executed.`,
  });

  const { data: existing } = await supabase
    .from("automations")
    .select("id, name, actions")
    .eq("org_id", ORG_ID)
    .eq("name", DAILY_AUTO_NAME)
    .maybeSingle();

  if (existing?.id) {
    const { data: full } = await supabase
      .from("automations")
      .select("status, trigger_config")
      .eq("id", existing.id)
      .maybeSingle();
    // Never force Live — if the user Paused this workflow, cron must not turn it back on.
    await supabase
      .from("automations")
      .update({
        requires_approval: true,
        trigger_type: "follow_up_due",
        description:
          "Created by Follow-up Agent. Daily cron proposes an audience; you Approve once, then it runs for each lead. Set Source/Channel filters on this workflow to limit who is proposed.",
        actions,
        trigger_config: (full?.trigger_config && typeof full.trigger_config === "object"
          ? full.trigger_config
          : {}) as Record<string, unknown>,
      })
      .eq("id", existing.id);
    return {
      id: existing.id as string,
      name: DAILY_AUTO_NAME,
      actions,
      status: String(full?.status || "Paused"),
    };
  }

  // New row starts Paused — operator must turn On in Automation UI.
  const { data: created, error } = await supabase
    .from("automations")
    .insert({
      org_id: ORG_ID,
      name: DAILY_AUTO_NAME,
      description:
        "Created by Follow-up Agent. Daily cron proposes an audience; you Approve once, then it runs for each lead.",
      status: "Paused",
      trigger_type: "follow_up_due",
      trigger_config: {},
      actions,
      requires_approval: true,
      run_count: 0,
      success_count: 0,
    })
    .select("id, name, actions, status")
    .single();

  if (error) throw new Error(error.message);
  return {
    id: created.id as string,
    name: DAILY_AUTO_NAME,
    actions: (created.actions || actions) as AutomationAction[],
    status: String(created.status || "Paused"),
  };
}

/** Open leads that need a polite nudge today. */
async function pickFollowUpAudience(
  supabase: ReturnType<typeof createServiceSupabase>,
  filters?: { sources?: string[]; channels?: string[] },
): Promise<
  Array<{
    id: string;
    name: string | null;
    company: string | null;
    phone: string | null;
    email: string | null;
    source: string | null;
    status: string | null;
    product_label: string | null;
    sales_person: string | null;
  }>
> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const { triggerFilterMatches } = await import("@/lib/automation-types");

  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, name, company, phone, email, source, status, product_label, sales_person, next_follow_up_at, last_activity_at, created_at",
    )
    .eq("org_id", ORG_ID)
    .not("status", "in", "(Won,Lost)")
    .order("last_activity_at", { ascending: true, nullsFirst: true })
    .limit(200);

  if (error) throw new Error(error.message);

  const rows = (data || []) as Array<{
    id: string;
    name: string | null;
    company: string | null;
    phone: string | null;
    email: string | null;
    source: string | null;
    status: string | null;
    product_label: string | null;
    sales_person: string | null;
    next_follow_up_at: string | null;
    last_activity_at: string | null;
    created_at: string;
  }>;

  const sourceFilter = filters?.sources?.length ? filters.sources : null;
  const channelFilter = filters?.channels?.length ? filters.channels : null;

  const eligible = rows.filter((l) => {
    if (!l.phone && !l.email) return false;
    if (sourceFilter && !triggerFilterMatches(sourceFilter, l.source)) return false;
    // Lead.source often mirrors channel (website/whatsapp/indiamart); apply channel filter the same way
    if (channelFilter && !triggerFilterMatches(channelFilter, l.source)) return false;
    if (l.next_follow_up_at && l.next_follow_up_at <= now) return true;
    if (!l.next_follow_up_at) {
      const last = l.last_activity_at || l.created_at;
      return last <= threeDaysAgo;
    }
    return false;
  });

  return eligible.slice(0, MAX_AUDIENCE).map((l) => ({
    id: l.id,
    name: l.name,
    company: l.company,
    phone: l.phone,
    email: l.email,
    source: l.source,
    status: l.status,
    product_label: l.product_label,
    sales_person: l.sales_person,
  }));
}

/**
 * Propose one daily follow-up campaign for human Approve/Reject.
 * Idempotent per IST calendar day while a pending proposal exists.
 */
export async function proposeDailyFollowUpCampaign(options?: {
  force?: boolean;
}): Promise<DailyFollowUpProposalResult> {
  const supabase = createServiceSupabase();
  const day = todayKey();

  if (!options?.force) {
    const { data: pending } = await supabase
      .from("automation_approvals")
      .select("id, context, created_at")
      .eq("org_id", ORG_ID)
      .eq("status", "pending")
      .eq("trigger_type", DAILY_TRIGGER)
      .order("created_at", { ascending: false })
      .limit(5);

    const already = (pending || []).find((row) => {
      const ctx = (row.context || {}) as { proposalDay?: string };
      return ctx.proposalDay === day;
    });
    if (already?.id) {
      return { skipped: "already_proposed_today", approvalId: already.id as string };
    }
  }

  const template = await resolveFollowUpTemplate(supabase);
  const auto = await ensureDailyFollowUpAutomation(supabase, template);

  // Respect Automation UI toggle — cron must not propose while Paused (manual Suggest can force).
  if (auto.status !== "Live" && !options?.force) {
    return { skipped: "automation_paused", leadCount: 0 };
  }

  const { data: autoRow } = await supabase
    .from("automations")
    .select("trigger_config")
    .eq("id", auto.id)
    .maybeSingle();
  const cfg = (autoRow?.trigger_config || {}) as { source?: unknown; channel?: unknown };
  const { normalizeTriggerFilterList } = await import("@/lib/automation-types");
  const sources = normalizeTriggerFilterList(cfg.source);
  const channels = normalizeTriggerFilterList(cfg.channel);

  const audience = await pickFollowUpAudience(supabase, {
    sources: sources.length ? sources : undefined,
    channels: channels.length ? channels : undefined,
  });
  if (!audience.length) {
    return { skipped: "no_leads_need_follow_up", leadCount: 0 };
  }

  const withPhone = audience.filter((l) => l.phone).length;
  const withEmail = audience.filter((l) => l.email).length;
  const names = audience
    .slice(0, 8)
    .map((l) => l.name || l.company || l.id.slice(0, 8))
    .join(", ");

  const goal = `Daily follow-up · ${audience.length} lead(s) · ${day}`;
  const summary = [
    `Follow-up Agent suggests contacting ${audience.length} open lead(s) today (${day}).`,
    sources.length || channels.length
      ? `Filters: source=${sources.length ? sources.join("|") : "any"} · channel=${channels.length ? channels.join("|") : "any"}`
      : "Filters: all sources / channels",
    template
      ? `Channel: WhatsApp template “${template.name}” (${template.language}) · ${withPhone} with phone.`
      : `Channel: Email fallback (no approved WhatsApp follow-up template found) · ${withEmail} with email. Tip: set FOLLOWUP_WA_TEMPLATE_NAME or approve a template with “follow” in the name.`,
    `Sample: ${names}${audience.length > 8 ? "…" : ""}`,
    `On Approve: message each lead, note the lead, schedule next follow-up in 48h.`,
  ].join("\n");

  const context: AutomationContext & {
    mode: "daily_followup_batch";
    proposalDay: string;
    leadIds: string[];
  } = {
    mode: "daily_followup_batch",
    proposalDay: day,
    leadIds: audience.map((l) => l.id),
    leadName: `${audience.length} leads`,
    company: "Daily follow-up audience",
  };

  const { data: approval, error } = await supabase
    .from("automation_approvals")
    .insert({
      org_id: ORG_ID,
      automation_id: auto.id,
      automation_name: auto.name,
      trigger_type: DAILY_TRIGGER,
      status: "pending",
      goal,
      summary,
      context,
      actions_snapshot: auto.actions,
      lead_id: null,
      conversation_id: null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await supabase.from("notifications").insert({
    org_id: ORG_ID,
    title: "Follow-up Agent · approval needed",
    body: goal,
    href: "/automation",
    metadata: { automation_approval: true, daily_followup: true, approval_id: approval.id },
  });

  return {
    approvalId: approval.id as string,
    leadCount: audience.length,
    leadNames: audience.map((l) => l.name || l.company || "Lead").slice(0, 12),
    hasWhatsAppTemplate: Boolean(template),
  };
}

/** After Approve: run workflow actions for every lead in the batch. */
export async function executeDailyFollowUpBatch(
  approvalId: string,
  resolvedBy?: string | null,
  opts?: { alreadyClaimed?: boolean; row?: Record<string, unknown> },
): Promise<{ ok: boolean; steps: string[]; error?: string; sent: number; failed: number }> {
  const supabase = createServiceSupabase();
  let row = opts?.row || null;

  if (!row) {
    if (opts?.alreadyClaimed) {
      throw new Error("Claimed approval row missing");
    }
    const { data: claimedRows, error: claimErr } = await supabase.rpc("claim_automation_approval", {
      p_approval_id: approvalId,
      p_resolved_by: resolvedBy || null,
    });
    if (!claimErr) {
      row = (Array.isArray(claimedRows) ? claimedRows[0] : claimedRows) as Record<
        string,
        unknown
      > | null;
      if (!row) throw new Error("Approval not found or already claimed");
    } else {
      const { data, error } = await supabase
        .from("automation_approvals")
        .select("*")
        .eq("id", approvalId)
        .eq("org_id", ORG_ID)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Approval not found");
      if (data.status !== "pending") throw new Error(`Already ${data.status}`);
      row = data as Record<string, unknown>;
    }
  }

  if ((row.org_id as string) && row.org_id !== ORG_ID) {
    throw new Error("Approval not found");
  }
  if (row.status !== "pending" && !opts?.alreadyClaimed) {
    throw new Error(`Already ${row.status}`);
  }

  const ctx = (row.context || {}) as {
    mode?: string;
    leadIds?: string[];
  };
  const leadIds = Array.isArray(ctx.leadIds) ? ctx.leadIds : [];
  if (ctx.mode !== "daily_followup_batch" || !leadIds.length) {
    throw new Error("Not a daily follow-up batch approval");
  }

  const { runActionSequenceForLead } = await import("@/server/automation-engine");
  const actions = (Array.isArray(row.actions_snapshot) ? row.actions_snapshot : []) as AutomationAction[];

  const steps: string[] = [];
  let sent = 0;
  let failed = 0;

  for (const leadId of leadIds) {
    try {
      const result = await runActionSequenceForLead(leadId, actions, {
        automationId: row.automation_id as string,
        automationName: (row.automation_name as string) || DAILY_AUTO_NAME,
      });
      steps.push(`${leadId.slice(0, 8)}:${result.steps.join("|")}`);
      if (result.steps.some((s) => s.startsWith("send_"))) sent += 1;
      else sent += 1;
    } catch (err) {
      failed += 1;
      steps.push(
        `${leadId.slice(0, 8)}:error:${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  await supabase
    .from("automation_approvals")
    .update({
      status: "approved",
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy || null,
    })
    .eq("id", approvalId);

  await supabase.from("automation_runs").insert({
    org_id: ORG_ID,
    automation_id: row.automation_id,
    status: failed && !sent ? "failed" : "success",
    trigger_type: `${DAILY_TRIGGER}:approved`,
    input: { approvalId, leadIds },
    output: { steps, sent, failed },
  });

  return {
    ok: failed === 0 || sent > 0,
    steps,
    sent,
    failed,
    error: failed ? `${failed} lead(s) failed` : undefined,
  };
}
