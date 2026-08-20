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
