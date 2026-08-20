/**
 * Monthly usage meters + hard cap enforcement (Phase 4).
 */
import { createServiceSupabase } from "@/lib/supabase";
import {
  PLAN_CATALOG,
  normalizePlanTier,
  tierFromLegacyPlan,
  type PlanTier,
} from "@/lib/plans";
import {
  DEFAULT_COST_RATES,
  eventCost,
  istMonthStartIso,
  ratesFromRows,
  type SpendEventRow,
} from "@/lib/spend-math";

export type UsageLimitCode = "ai_cap" | "wa_cap" | "seat_cap" | "billing_past_due";

export class UsageLimitError extends Error {
  readonly statusCode = 402;
  readonly code: UsageLimitCode;

  constructor(code: UsageLimitCode, message: string) {
    super(message);
    this.name = "UsageLimitError";
    this.code = code;
  }
}

export type OrgUsageSnapshot = {
  orgId: string;
  planTier: PlanTier;
  planLabel: string;
  billingStatus: string;
  billingPeriodEnd: string | null;
  hasOwnOpenAiKey: boolean;
  aiSpendInr: number;
  whatsappMessages: number;
  seatsUsed: number;
  pendingInvites: number;
  limits: {
    monthlyAiSpendCapInr: number | null;
    monthlyWhatsAppCap: number | null;
    maxSeats: number | null;
  };
};

const CACHE_MS = 20_000;
const cache = new Map<string, { at: number; snapshot: OrgUsageSnapshot }>();

function effectiveTier(tier: PlanTier, billingStatus: string): PlanTier {
  if (billingStatus === "past_due" || billingStatus === "cancelled") {
    return tier === "enterprise" ? "enterprise" : "free";
  }
  return tier;
}

function limitsForSnapshot(tier: PlanTier, billingStatus: string, hasOwnOpenAiKey: boolean) {
  const effective = effectiveTier(tier, billingStatus);
  const base = PLAN_CATALOG[effective];
  return {
    monthlyAiSpendCapInr: hasOwnOpenAiKey ? null : base.monthlyAiSpendCapInr,
    monthlyWhatsAppCap: base.monthlyWhatsAppCap,
    maxSeats: base.maxSeats,
  };
}

async function fetchSpendEvents(orgId: string, fromIso: string): Promise<SpendEventRow[]> {
  const supabase = createServiceSupabase();
  const all: SpendEventRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("api_spend_events")
      .select(
        "id, org_id, kind, vendor, model, prompt_tokens, completion_tokens, total_tokens, units, conversation_id, metadata, created_at",
      )
      .eq("org_id", orgId)
      .gte("created_at", fromIso)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return [];
      throw new Error(error.message);
    }
    const chunk = (data || []) as SpendEventRow[];
    all.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return all;
}

async function loadCostRates() {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.from("cost_rates").select("key, amount, unit");
  if (error) return DEFAULT_COST_RATES;
  return ratesFromRows(data);
}

export async function getOrgUsageSnapshot(orgId: string, opts?: { fresh?: boolean }): Promise<OrgUsageSnapshot> {
  if (!opts?.fresh) {
    const hit = cache.get(orgId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.snapshot;
  }

  const supabase = createServiceSupabase();
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .select("plan, plan_tier, billing_status, billing_period_end")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr) throw new Error(orgErr.message);
  if (!org) throw new Error("Organization not found");

  let planTier = normalizePlanTier(org.plan_tier);
  if (planTier === "free" && org.plan) {
    planTier = tierFromLegacyPlan(org.plan);
  }
  const billingStatus = String(org.billing_status || "active");

  const [{ data: secretRow }, { count: memberCount }, { count: inviteCount }] = await Promise.all([
    supabase.from("org_secrets").select("openai_api_key").eq("org_id", orgId).maybeSingle(),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase
      .from("org_invites")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "pending"),
  ]);

  const hasOwnOpenAiKey = Boolean(secretRow?.openai_api_key?.trim());
  const limits = limitsForSnapshot(planTier, billingStatus, hasOwnOpenAiKey);

  const fromIso = istMonthStartIso(new Date());
  const [events, rates] = await Promise.all([fetchSpendEvents(orgId, fromIso), loadCostRates()]);

  let aiSpendInr = 0;
  let whatsappMessages = 0;
  for (const event of events) {
    if (event.kind === "openai_chat" || event.kind === "openai_embed") {
      aiSpendInr += eventCost(event, rates).inr;
    }
    if (event.kind === "whatsapp_session" || event.kind === "whatsapp_template") {
      whatsappMessages += Number(event.units || 1);
    }
  }

  const snapshot: OrgUsageSnapshot = {
    orgId,
    planTier,
    planLabel: PLAN_CATALOG[planTier].label,
    billingStatus,
    billingPeriodEnd:
      typeof org.billing_period_end === "string" ? org.billing_period_end : null,
    hasOwnOpenAiKey,
    aiSpendInr,
    whatsappMessages,
    seatsUsed: memberCount ?? 0,
    pendingInvites: inviteCount ?? 0,
    limits,
  };

  cache.set(orgId, { at: Date.now(), snapshot });
  return snapshot;
}

export function invalidateOrgUsageCache(orgId: string) {
  cache.delete(orgId);
}

export async function assertAiUsageAllowed(orgId: string): Promise<void> {
  const snap = await getOrgUsageSnapshot(orgId);
  if (snap.hasOwnOpenAiKey) return;
  if (snap.billingStatus === "past_due") {
    throw new UsageLimitError(
      "billing_past_due",
      "Billing is past due. Update payment in Settings → Billing to restore AI replies.",
    );
  }
  const cap = snap.limits.monthlyAiSpendCapInr;
  if (cap == null) return;
  if (snap.aiSpendInr >= cap) {
    throw new UsageLimitError(
      "ai_cap",
      `Monthly AI usage limit reached (₹${cap.toLocaleString("en-IN")} on ${snap.planLabel}). Upgrade in Settings → Billing or add your own OpenAI key.`,
    );
  }
}

export async function assertWhatsAppSendAllowed(orgId: string): Promise<void> {
  const snap = await getOrgUsageSnapshot(orgId);
  if (snap.billingStatus === "past_due") {
    throw new UsageLimitError(
      "billing_past_due",
      "Billing is past due. Update payment in Settings → Billing to send WhatsApp messages.",
    );
  }
  const cap = snap.limits.monthlyWhatsAppCap;
  if (cap == null) return;
  if (snap.whatsappMessages >= cap) {
    throw new UsageLimitError(
      "wa_cap",
      `Monthly WhatsApp limit reached (${cap.toLocaleString("en-IN")} messages on ${snap.planLabel}). Upgrade in Settings → Billing.`,
    );
  }
}

export async function assertSeatAllowed(orgId: string): Promise<void> {
  const snap = await getOrgUsageSnapshot(orgId);
  const cap = snap.limits.maxSeats;
  if (cap == null) return;
  const total = snap.seatsUsed + snap.pendingInvites;
  if (total >= cap) {
    throw new UsageLimitError(
      "seat_cap",
      `Team seat limit reached (${cap} on ${snap.planLabel}). Upgrade in Settings → Billing.`,
    );
  }
}

export async function loadOrgOpenAiKey(orgId: string): Promise<string | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("org_secrets")
    .select("openai_api_key")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    console.error("org secrets load failed", error.message);
    return null;
  }
  const key = data?.openai_api_key?.trim();
  return key || null;
}
