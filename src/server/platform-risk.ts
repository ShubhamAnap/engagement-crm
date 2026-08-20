/**
 * Cross-tenant risk signals for the platform console.
 *
 * Everything here is derived from tables the app already writes — there is no separate
 * abuse-tracking pipeline. Signals are advisory: they tell an operator which workspace to
 * look at, and never suspend anything on their own.
 *
 * Cost: one paged scan of `api_spend_events` over the trailing window plus one read of
 * `organizations`. Fine for hundreds of workspaces; revisit if that grows by an order of
 * magnitude.
 */
import { createServerFn } from "@tanstack/react-start";
import { createServiceSupabase } from "@/lib/supabase";
import {
  applyCustomLimits,
  normalizePlanTier,
  parseCustomLimits,
  PAST_DUE_GRACE_DAYS,
  PLAN_CATALOG,
} from "@/lib/plans";
import { disabledFeatures, parseFeatureFlags } from "@/lib/features";
import {
  DEFAULT_COST_RATES,
  eventCost,
  istMonthStartIso,
  ratesFromRows,
  type SpendEventRow,
} from "@/lib/spend-math";
import { requirePlatformAdmin } from "@/server/platform-auth";

export type RiskSeverity = "high" | "medium" | "low";

export type RiskSignal = {
  code:
    | "spend_spike"
    | "ai_cap_breach"
    | "wa_cap_breach"
    | "past_due_expired"
    | "past_due"
    | "grace_open"
    | "trial_ending"
    | "contract_ending"
    | "features_disabled"
    | "abandoned";
  severity: RiskSeverity;
  label: string;
  detail: string;
};

export type OrgRiskRow = {
  orgId: string;
  name: string;
  planTier: string;
  billingStatus: string;
  memberCount: number;
  aiSpendInr: number;
  aiCapInr: number | null;
  whatsappMessages: number;
  whatsappCap: number | null;
  todaySpendInr: number;
  avgDailySpendInr: number;
  signals: RiskSignal[];
  /** Highest severity across signals, for sorting. */
  score: number;
};

const SEVERITY_WEIGHT: Record<RiskSeverity, number> = { high: 100, medium: 10, low: 1 };
const SPIKE_MULTIPLE = 3;
const SPIKE_FLOOR_INR = 100;
const TRAILING_DAYS = 8;
const DAY_MS = 86_400_000;

function daysBetween(fromIso: string, to: Date): number {
  return (to.getTime() - new Date(fromIso).getTime()) / DAY_MS;
}

function fmtInr(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

async function fetchRecentSpend(fromIso: string): Promise<SpendEventRow[]> {
  const supabase = createServiceSupabase();
  const all: SpendEventRow[] = [];
  const PAGE = 1000;
  const MAX = 20_000;
  for (let from = 0; from < MAX; from += PAGE) {
    const { data, error } = await supabase
      .from("api_spend_events")
      .select(
        "id, org_id, kind, vendor, model, prompt_tokens, completion_tokens, total_tokens, units, conversation_id, metadata, created_at",
      )
      .gte("created_at", fromIso)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return all;
      throw new Error(error.message);
    }
    const chunk = (data || []) as SpendEventRow[];
    all.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return all;
}

export const getPlatformRiskSignals = createServerFn({ method: "GET" }).handler(async () => {
  await requirePlatformAdmin();
  const supabase = createServiceSupabase();

  const orgsRes = await supabase.from("organizations").select("*").limit(500);
  if (orgsRes.error) throw new Error(orgsRes.error.message);
  const orgs = orgsRes.data ?? [];

  const now = new Date();
  const monthStart = istMonthStartIso(now);
  const trailingStart = new Date(now.getTime() - TRAILING_DAYS * DAY_MS).toISOString();
  const scanFrom = trailingStart < monthStart ? trailingStart : monthStart;

  const [events, ratesRes, memberRes] = await Promise.all([
    fetchRecentSpend(scanFrom),
    supabase.from("cost_rates").select("key, amount, unit"),
    supabase.from("profiles").select("org_id"),
  ]);
  const rates = ratesRes.error ? DEFAULT_COST_RATES : ratesFromRows(ratesRes.data);

  const members = new Map<string, number>();
  for (const row of memberRes.data ?? []) {
    const id = String((row as { org_id?: string }).org_id || "");
    if (id) members.set(id, (members.get(id) ?? 0) + 1);
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  type Totals = { monthAi: number; monthWa: number; today: number; trailing: number };
  const totals = new Map<string, Totals>();
  const bump = (orgId: string): Totals => {
    let t = totals.get(orgId);
    if (!t) {
      t = { monthAi: 0, monthWa: 0, today: 0, trailing: 0 };
      totals.set(orgId, t);
    }
    return t;
  };

  for (const event of events) {
    const orgId = String(event.org_id || "");
    if (!orgId) continue;
    const t = bump(orgId);
    const created = String(event.created_at || "");
    const isAi = event.kind === "openai_chat" || event.kind === "openai_embed";
    const inr = isAi ? eventCost(event, rates).inr : 0;

    if (created >= monthStart) {
      if (isAi) t.monthAi += inr;
      if (event.kind === "whatsapp_session" || event.kind === "whatsapp_template") {
        t.monthWa += Number(event.units || 1);
      }
    }
    if (!isAi) continue;
    if (created.slice(0, 10) === todayKey) t.today += inr;
    else if (created >= trailingStart) t.trailing += inr;
  }

  const rows: OrgRiskRow[] = orgs.map((org) => {
    const orgId = String(org.id);
    const t = totals.get(orgId) ?? { monthAi: 0, monthWa: 0, today: 0, trailing: 0 };
    const tier = normalizePlanTier(org.plan_tier);
    const plan = PLAN_CATALOG[tier];
    const caps = applyCustomLimits(
      {
        monthlyAiSpendCapInr: plan.monthlyAiSpendCapInr,
        monthlyWhatsAppCap: plan.monthlyWhatsAppCap,
        maxSeats: plan.maxSeats,
      },
      parseCustomLimits(org.custom_limits),
    );
    const billingStatus = String(org.billing_status || "active");
    const memberCount = members.get(orgId) ?? 0;
    // Trailing spend covers the days before today in the scan window.
    const avgDaily = t.trailing / Math.max(TRAILING_DAYS - 1, 1);
    const signals: RiskSignal[] = [];

    if (t.today > SPIKE_FLOOR_INR && avgDaily > 0 && t.today > avgDaily * SPIKE_MULTIPLE) {
      signals.push({
        code: "spend_spike",
        severity: "high",
        label: "AI spend spike",
        detail: `${fmtInr(t.today)} today vs ${fmtInr(avgDaily)}/day average`,
      });
    }

    if (caps.monthlyAiSpendCapInr != null && t.monthAi >= caps.monthlyAiSpendCapInr) {
      signals.push({
        code: "ai_cap_breach",
        severity: "medium",
        label: "AI cap reached",
        detail: `${fmtInr(t.monthAi)} of ${fmtInr(caps.monthlyAiSpendCapInr)} this month`,
      });
    }

    if (caps.monthlyWhatsAppCap != null && t.monthWa >= caps.monthlyWhatsAppCap) {
      signals.push({
        code: "wa_cap_breach",
        severity: "medium",
        label: "WhatsApp cap reached",
        detail: `${t.monthWa.toLocaleString("en-IN")} of ${caps.monthlyWhatsAppCap.toLocaleString("en-IN")} messages`,
      });
    }

    if (billingStatus === "past_due") {
      const since = typeof org.past_due_since === "string" ? org.past_due_since : null;
      const age = since ? daysBetween(since, now) : 0;
      const expired = since != null && age > PAST_DUE_GRACE_DAYS;
      signals.push({
        code: expired ? "past_due_expired" : "past_due",
        severity: expired ? "high" : "medium",
        label: expired ? "Past due, grace spent" : "Past due",
        detail: since
          ? `${Math.floor(age)} day${Math.floor(age) === 1 ? "" : "s"} since first failed payment`
          : "Payment failed; grace window not started yet",
      });
    }

    if (typeof org.usage_grace_until === "string" && new Date(org.usage_grace_until) > now) {
      signals.push({
        code: "grace_open",
        severity: "low",
        label: "Over cap on grace",
        detail: `Serving over the cap until ${new Date(org.usage_grace_until).toLocaleDateString("en-IN")}`,
      });
    }

    if (typeof org.trial_ends_at === "string") {
      const left = daysBetween(new Date().toISOString(), new Date(org.trial_ends_at));
      if (left > 0 && left <= 3) {
        signals.push({
          code: "trial_ending",
          severity: "medium",
          label: "Trial ending",
          detail: `${Math.ceil(left)} day${Math.ceil(left) === 1 ? "" : "s"} left`,
        });
      }
    }

    if (typeof org.contract_ends_at === "string") {
      const left = daysBetween(new Date().toISOString(), new Date(org.contract_ends_at));
      if (left > 0 && left <= 30) {
        signals.push({
          code: "contract_ending",
          severity: "low",
          label: "Contract ending",
          detail: `${Math.ceil(left)} days left${org.contract_reference ? ` on ${org.contract_reference}` : ""}`,
        });
      }
    }

    const off = disabledFeatures(parseFeatureFlags(org.feature_flags));
    if (off.length > 0) {
      signals.push({
        code: "features_disabled",
        severity: "low",
        label: "Modules off",
        detail: off.join(", "),
      });
    }

    if (memberCount === 0) {
      signals.push({
        code: "abandoned",
        severity: "low",
        label: "No members",
        detail: "Workspace has no user accounts",
      });
    }

    return {
      orgId,
      name: String(org.name || "Workspace"),
      planTier: tier,
      billingStatus,
      memberCount,
      aiSpendInr: Math.round(t.monthAi * 100) / 100,
      aiCapInr: caps.monthlyAiSpendCapInr,
      whatsappMessages: t.monthWa,
      whatsappCap: caps.monthlyWhatsAppCap,
      todaySpendInr: Math.round(t.today * 100) / 100,
      avgDailySpendInr: Math.round(avgDaily * 100) / 100,
      signals,
      score: signals.reduce((sum, s) => sum + SEVERITY_WEIGHT[s.severity], 0),
    };
  });

  return {
    generatedAt: now.toISOString(),
    rows: rows.filter((r) => r.signals.length > 0).sort((a, b) => b.score - a.score),
    scannedOrgs: rows.length,
  };
});
