/** Plan tiers and hard usage caps (Phase 4 billing). */

export type PlanTier = "free" | "starter" | "pro" | "enterprise";

export type PlanLimits = {
  /** Max platform-billed AI spend per calendar month (INR). null = unlimited. */
  monthlyAiSpendCapInr: number | null;
  /** Max outbound WhatsApp messages per month (session + template). null = unlimited. */
  monthlyWhatsAppCap: number | null;
  /** Max active team members + pending invites. null = unlimited. */
  maxSeats: number | null;
  /** Display price per month (INR) — checkout only; not stored in DB. */
  priceInr: number | null;
  label: string;
};

export const PLAN_CATALOG: Record<PlanTier, PlanLimits> = {
  free: {
    label: "Free",
    priceInr: 0,
    monthlyAiSpendCapInr: 500,
    monthlyWhatsAppCap: 100,
    maxSeats: 3,
  },
  starter: {
    label: "Starter",
    priceInr: 2999,
    monthlyAiSpendCapInr: 5000,
    monthlyWhatsAppCap: 2000,
    maxSeats: 10,
  },
  pro: {
    label: "Pro",
    priceInr: 9999,
    monthlyAiSpendCapInr: 25000,
    monthlyWhatsAppCap: 10000,
    maxSeats: 50,
  },
  enterprise: {
    label: "Enterprise",
    priceInr: null,
    monthlyAiSpendCapInr: null,
    monthlyWhatsAppCap: null,
    maxSeats: null,
  },
};

export function normalizePlanTier(raw: string | null | undefined): PlanTier {
  const v = String(raw || "free")
    .trim()
    .toLowerCase();
  if (v === "starter") return "starter";
  if (v === "pro") return "pro";
  if (v === "enterprise") return "enterprise";
  return "free";
}

/** Map legacy organizations.plan display string to tier. */
export function tierFromLegacyPlan(plan: string | null | undefined): PlanTier {
  const v = String(plan || "")
    .trim()
    .toLowerCase();
  if (v === "enterprise") return "enterprise";
  if (v === "starter") return "starter";
  if (v === "pro") return "pro";
  return "free";
}

export function planLabelForTier(tier: PlanTier): string {
  return PLAN_CATALOG[tier].label;
}

export function isUnlimited(value: number | null | undefined): boolean {
  return value == null;
}

/** Caps that a negotiated contract can override per workspace. */
export type CapKey = "monthlyAiSpendCapInr" | "monthlyWhatsAppCap" | "maxSeats";

export const CAP_KEYS: CapKey[] = ["monthlyAiSpendCapInr", "monthlyWhatsAppCap", "maxSeats"];

/**
 * Absent key = use the plan default. Explicit null = unlimited.
 * `undefined` and `null` mean different things here, so read with `in`, not `??`.
 */
export type CustomLimits = Partial<Record<CapKey, number | null>>;

/** Days a workspace may keep working after first breaching a cap. */
export const USAGE_GRACE_DAYS = 3;

/** Days a workspace may keep working after billing goes past due. */
export const PAST_DUE_GRACE_DAYS = 7;

/** Fraction of a cap at which the UI starts warning. */
export const SOFT_LIMIT_RATIO = 0.8;

export function parseCustomLimits(raw: unknown): CustomLimits {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: CustomLimits = {};
  for (const key of CAP_KEYS) {
    if (!(key in source)) continue;
    const value = source[key];
    if (value === null) {
      out[key] = null;
      continue;
    }
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) out[key] = n;
  }
  return out;
}

/** Plan caps with any negotiated overrides applied. */
export function applyCustomLimits(
  base: Pick<PlanLimits, CapKey>,
  overrides: CustomLimits,
): Pick<PlanLimits, CapKey> {
  const out = { ...base };
  for (const key of CAP_KEYS) {
    if (key in overrides) out[key] = overrides[key] ?? null;
  }
  return out;
}

/** null cap, or usage below the warn threshold, means nothing to show. */
export function isNearLimit(used: number, cap: number | null): boolean {
  if (cap == null || cap <= 0) return false;
  return used / cap >= SOFT_LIMIT_RATIO && used < cap;
}
