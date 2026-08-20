/**
 * Monthly usage meters + hard cap enforcement (Phase 4).
 */
import { createServiceSupabase } from "@/lib/supabase";
import {
  applyCustomLimits,
  normalizePlanTier,
  parseCustomLimits,
  PAST_DUE_GRACE_DAYS,
  PLAN_CATALOG,
  tierFromLegacyPlan,
  USAGE_GRACE_DAYS,
  type CustomLimits,
  type PlanTier,
} from "@/lib/plans";
import {
  featureLabel,
  parseFeatureFlags,
  type FeatureFlags,
  type FeatureKey,
} from "@/lib/features";
import {
  DEFAULT_COST_RATES,
  eventCost,
  istMonthStartIso,
  ratesFromRows,
  type SpendEventRow,
} from "@/lib/spend-math";

export type UsageLimitCode =
  | "ai_cap"
  | "wa_cap"
  | "seat_cap"
  | "billing_past_due"
  | "feature_disabled";

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
  features: FeatureFlags;
  /** True while a paid-plan trial is still running. */
  trialActive: boolean;
  trialEndsAt: string | null;
  /** Cap overage is tolerated until this time (null = no grace open). */
  usageGraceUntil: string | null;
  /** Set when limits come from a negotiated contract rather than the plan. */
  hasCustomLimits: boolean;
  /** Past-due workspaces keep working until this time. */
  pastDueGraceUntil: string | null;
};

const CACHE_MS = 20_000;
const cache = new Map<string, { at: number; snapshot: OrgUsageSnapshot }>();

const DAY_MS = 86_400_000;

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

function isFuture(iso: string | null): boolean {
  return Boolean(iso) && new Date(iso as string).getTime() > Date.now();
}

/** IST month key matching the window the usage counters are summed over. */
function istMonthKey(): string {
  return istMonthStartIso(new Date()).slice(0, 7);
}

/**
 * A lapsed subscription drops to Free limits, but an active trial holds the paid tier
 * and enterprise never downgrades.
 */
function effectiveTier(
  tier: PlanTier,
  billingStatus: string,
  trialActive: boolean,
): PlanTier {
  if (trialActive) return tier;
  if (billingStatus === "past_due" || billingStatus === "cancelled") {
    return tier === "enterprise" ? "enterprise" : "free";
  }
  return tier;
}

function limitsForSnapshot(options: {
  tier: PlanTier;
  billingStatus: string;
  hasOwnOpenAiKey: boolean;
  trialActive: boolean;
  customLimits: CustomLimits;
}) {
  const effective = effectiveTier(options.tier, options.billingStatus, options.trialActive);
  const planLimits = PLAN_CATALOG[effective];
  const withContract = applyCustomLimits(
    {
      monthlyAiSpendCapInr: planLimits.monthlyAiSpendCapInr,
      monthlyWhatsAppCap: planLimits.monthlyWhatsAppCap,
      maxSeats: planLimits.maxSeats,
    },
    options.customLimits,
  );
  return {
    ...withContract,
    monthlyAiSpendCapInr: options.hasOwnOpenAiKey ? null : withContract.monthlyAiSpendCapInr,
  };
}

type BillingRow = {
  plan?: string | null;
  plan_tier?: string | null;
  billing_status?: string | null;
  billing_period_end?: string | null;
  feature_flags?: unknown;
  custom_limits?: unknown;
  trial_ends_at?: string | null;
  usage_grace_until?: string | null;
  usage_grace_month?: string | null;
  past_due_since?: string | null;
};

const BILLING_COLUMNS_BASE = "plan, plan_tier, billing_status, billing_period_end";
const BILLING_COLUMNS_045 =
  `${BILLING_COLUMNS_BASE}, feature_flags, custom_limits, trial_ends_at, usage_grace_until, usage_grace_month, past_due_since`;

/** Falls back to the pre-045 column set so a missing migration degrades instead of breaking. */
async function loadBillingRow(orgId: string): Promise<BillingRow> {
  const supabase = createServiceSupabase();
  const full = await supabase
    .from("organizations")
    .select(BILLING_COLUMNS_045)
    .eq("id", orgId)
    .maybeSingle();
  if (!full.error) {
    if (!full.data) throw new Error("Organization not found");
    return full.data as BillingRow;
  }
  if (full.error.code !== "42703") throw new Error(full.error.message);

  const base = await supabase
    .from("organizations")
    .select(BILLING_COLUMNS_BASE)
    .eq("id", orgId)
    .maybeSingle();
  if (base.error) throw new Error(base.error.message);
  if (!base.data) throw new Error("Organization not found");
  return base.data as BillingRow;
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
  const org = await loadBillingRow(orgId);

  let planTier = normalizePlanTier(org.plan_tier);
  if (planTier === "free" && org.plan) {
    planTier = tierFromLegacyPlan(org.plan);
  }
  const billingStatus = String(org.billing_status || "active");
  const trialEndsAt = typeof org.trial_ends_at === "string" ? org.trial_ends_at : null;
  const trialActive = isFuture(trialEndsAt);
  const customLimits = parseCustomLimits(org.custom_limits);
  const features = parseFeatureFlags(org.feature_flags);
  const currentMonth = istMonthKey();
  // Grace belongs to one billing month; a stale month means counters have reset.
  const usageGraceUntil =
    org.usage_grace_month === currentMonth && typeof org.usage_grace_until === "string"
      ? org.usage_grace_until
      : null;
  const pastDueGraceUntil =
    billingStatus === "past_due" && typeof org.past_due_since === "string"
      ? addDays(new Date(org.past_due_since), PAST_DUE_GRACE_DAYS).toISOString()
      : null;

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
  const limits = limitsForSnapshot({
    tier: planTier,
    billingStatus,
    hasOwnOpenAiKey,
    trialActive,
    customLimits,
  });

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
    features,
    trialActive,
    trialEndsAt,
    usageGraceUntil,
    hasCustomLimits: Object.keys(customLimits).length > 0,
    pastDueGraceUntil,
  };

  cache.set(orgId, { at: Date.now(), snapshot });
  return snapshot;
}

export function invalidateOrgUsageCache(orgId: string) {
  cache.delete(orgId);
}

function requireFeature(snap: OrgUsageSnapshot, feature: FeatureKey): void {
  if (snap.features[feature]) return;
  throw new UsageLimitError(
    "feature_disabled",
    `${featureLabel(feature)} is turned off for this workspace. Contact support to re-enable it.`,
  );
}

/** Platform admins can switch a module off for one workspace. */
export async function assertFeatureEnabled(orgId: string, feature: FeatureKey): Promise<void> {
  requireFeature(await getOrgUsageSnapshot(orgId), feature);
}

/**
 * Past-due billing does not cut service off instantly — the workspace keeps working for
 * PAST_DUE_GRACE_DAYS from the first failed payment. Returns true when the grace is spent.
 */
async function pastDueBlocked(snap: OrgUsageSnapshot): Promise<boolean> {
  if (snap.billingStatus !== "past_due") return false;
  if (!snap.pastDueGraceUntil) {
    // First time we have seen this workspace past due: start the clock, allow this call.
    await startPastDueGrace(snap.orgId);
    return false;
  }
  return !isFuture(snap.pastDueGraceUntil);
}

async function startPastDueGrace(orgId: string): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("organizations")
    .update({ past_due_since: new Date().toISOString() })
    .eq("id", orgId)
    .is("past_due_since", null);
  if (error && error.code !== "42703") {
    console.error("[usage] could not start past-due grace", error.message);
  }
  invalidateOrgUsageCache(orgId);
}

/**
 * First breach of a cap in a billing month opens a grace window rather than blocking, so a
 * customer mid-campaign is warned instead of cut off. Returns true when the call must fail.
 */
async function capBlocked(snap: OrgUsageSnapshot): Promise<boolean> {
  if (snap.usageGraceUntil) return !isFuture(snap.usageGraceUntil);
  await openUsageGrace(snap.orgId);
  return false;
}

async function openUsageGrace(orgId: string): Promise<void> {
  const supabase = createServiceSupabase();
  const until = addDays(new Date(), USAGE_GRACE_DAYS).toISOString();
  const { error } = await supabase
    .from("organizations")
    .update({ usage_grace_until: until, usage_grace_month: istMonthKey() })
    .eq("id", orgId);
  if (error && error.code !== "42703") {
    console.error("[usage] could not open grace window", error.message);
  }
  invalidateOrgUsageCache(orgId);
}

function pastDueMessage(action: string): string {
  return `Billing is past due and the grace period has ended. Update payment in Settings → Billing to ${action}.`;
}

export async function assertAiUsageAllowed(orgId: string): Promise<void> {
  const snap = await getOrgUsageSnapshot(orgId);
  requireFeature(snap, "ai");
  if (snap.hasOwnOpenAiKey) return;
  if (await pastDueBlocked(snap)) {
    throw new UsageLimitError("billing_past_due", pastDueMessage("restore AI replies"));
  }
  const cap = snap.limits.monthlyAiSpendCapInr;
  if (cap == null) return;
  if (snap.aiSpendInr >= cap && (await capBlocked(snap))) {
    throw new UsageLimitError(
      "ai_cap",
      `Monthly AI usage limit reached (₹${cap.toLocaleString("en-IN")} on ${snap.planLabel}) and the grace period has ended. Upgrade in Settings → Billing or add your own OpenAI key.`,
    );
  }
}

export async function assertWhatsAppSendAllowed(orgId: string): Promise<void> {
  const snap = await getOrgUsageSnapshot(orgId);
  requireFeature(snap, "whatsapp");
  if (await pastDueBlocked(snap)) {
    throw new UsageLimitError("billing_past_due", pastDueMessage("send WhatsApp messages"));
  }
  const cap = snap.limits.monthlyWhatsAppCap;
  if (cap == null) return;
  if (snap.whatsappMessages >= cap && (await capBlocked(snap))) {
    throw new UsageLimitError(
      "wa_cap",
      `Monthly WhatsApp limit reached (${cap.toLocaleString("en-IN")} messages on ${snap.planLabel}) and the grace period has ended. Upgrade in Settings → Billing.`,
    );
  }
}

/**
 * Seats are not graced: letting a workspace past its seat cap creates a member who would
 * have to be removed later, which is worse than refusing the invite now.
 */
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
