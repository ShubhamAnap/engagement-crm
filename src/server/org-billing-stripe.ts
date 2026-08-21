/**
 * Stripe Checkout (USD) for Phase 2 worldwide billing.
 * Uses Stripe REST API via fetch — no SDK dependency.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import {
  PLAN_CATALOG,
  normalizePlanTier,
  planLabelForTier,
  type PlanTier,
} from "@/lib/plans";
import { invalidateOrgUsageCache } from "@/server/org-usage";
import { recordAuditEvent } from "@/server/audit-log";
import { requireStaffUser } from "@/server/staff-auth";

function appBaseUrl(): string {
  return String(process.env.VITE_APP_URL || "http://localhost:8080").replace(/\/$/, "");
}

function forbidden(message = "Only Admin can manage billing"): never {
  const err = new Error(message);
  (err as Error & { statusCode: number }).statusCode = 403;
  throw err;
}

async function requireAdmin() {
  const auth = await requireStaffUser();
  if (auth.profile.role !== "Admin") forbidden();
  return auth;
}

export function stripeConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() &&
      (process.env.STRIPE_PRICE_STARTER || process.env.STRIPE_PRICE_PRO),
  );
}

function stripePriceId(tier: "starter" | "pro"): string | null {
  if (tier === "starter") return process.env.STRIPE_PRICE_STARTER?.trim() || null;
  if (tier === "pro") return process.env.STRIPE_PRICE_PRO?.trim() || null;
  return null;
}

function stripeAuthHeader(): string {
  const key = process.env.STRIPE_SECRET_KEY!.trim();
  return `Bearer ${key}`;
}

export const createStripeCheckout = createServerFn({ method: "POST" })
  .validator(z.object({ planTier: z.enum(["starter", "pro"]) }))
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    if (!stripeConfigured()) {
      throw new Error(
        "Stripe is not configured. Use Razorpay (INR) or contact support for USD billing.",
      );
    }

    const priceId = stripePriceId(data.planTier);
    if (!priceId) {
      throw new Error(
        `Stripe price missing for ${data.planTier}. Set STRIPE_PRICE_${data.planTier.toUpperCase()}.`,
      );
    }

    const supabase = createServiceSupabase();
    const { data: org } = await supabase
      .from("organizations")
      .select("stripe_subscription_id, billing_status, name")
      .eq("id", auth.profile.org_id)
      .maybeSingle();

    if (org?.stripe_subscription_id && org.billing_status === "active") {
      throw new Error(`You are already on ${planLabelForTier(normalizePlanTier(data.planTier))}.`);
    }

    const base = appBaseUrl();
    const params = new URLSearchParams();
    params.set("mode", "subscription");
    params.set("success_url", `${base}/settings?billing=success`);
    params.set("cancel_url", `${base}/settings?billing=cancel`);
    params.set("client_reference_id", auth.profile.org_id);
    params.set("customer_email", auth.profile.email);
    params.set("line_items[0][price]", priceId);
    params.set("line_items[0][quantity]", "1");
    params.set("metadata[org_id]", auth.profile.org_id);
    params.set("metadata[plan_tier]", data.planTier);
    params.set("subscription_data[metadata][org_id]", auth.profile.org_id);
    params.set("subscription_data[metadata][plan_tier]", data.planTier);

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: stripeAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };

    if (!res.ok) {
      throw new Error(json.error?.message || `Stripe error (${res.status})`);
    }

    if (!json.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }

    void recordAuditEvent({
      orgId: auth.profile.org_id,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "billing.stripe_checkout",
      resourceType: "subscription",
      resourceId: json.id || undefined,
      metadata: { planTier: data.planTier },
    });

    return { ok: true as const, checkoutUrl: json.url, sessionId: json.id || null };
  });

/** Apply Stripe subscription state — service role / webhook only. */
export async function applyStripeBillingUpdate(options: {
  orgId: string;
  planTier?: PlanTier;
  billingStatus?: "active" | "past_due" | "cancelled";
  subscriptionId?: string | null;
  customerId?: string | null;
  periodEnd?: string | null;
  eventType: string;
  externalId?: string;
  payload: Record<string, unknown>;
  amount?: number | null;
  currency?: string | null;
}): Promise<void> {
  const supabase = createServiceSupabase();
  const patch: Record<string, unknown> = {};
  if (options.planTier) {
    patch.plan_tier = options.planTier;
    patch.plan = planLabelForTier(options.planTier);
  }
  if (options.billingStatus) patch.billing_status = options.billingStatus;
  if (options.subscriptionId !== undefined) patch.stripe_subscription_id = options.subscriptionId;
  if (options.customerId) patch.stripe_customer_id = options.customerId;
  if (options.periodEnd) patch.billing_period_end = options.periodEnd;
  if (options.billingStatus === "active") patch.past_due_since = null;

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("organizations").update(patch).eq("id", options.orgId);
    if (error) {
      // Pre-047 DBs lack stripe_* columns — still record the event below.
      if (!["PGRST204", "42703"].includes(error.code || "")) {
        throw new Error(error.message);
      }
      console.warn("[stripe billing] org update skipped (run 047_stripe_billing.sql)", error.message);
    }
  }

  if (options.billingStatus === "past_due") {
    const started = await supabase
      .from("organizations")
      .update({ past_due_since: new Date().toISOString() })
      .eq("id", options.orgId)
      .is("past_due_since", null);
    if (started.error && !["PGRST204", "42703"].includes(started.error.code || "")) {
      console.error("[stripe billing] past_due_since", started.error.message);
    }
  }

  const row = {
    org_id: options.orgId,
    provider: "stripe",
    event_type: options.eventType,
    external_id: options.externalId || null,
    payload: options.payload,
    amount: options.amount ?? null,
    currency: options.currency ?? "usd",
    invoice_id: options.externalId || null,
    status: options.billingStatus || null,
  };
  const withInvoice = await supabase.from("billing_events").insert(row);
  if (withInvoice.error?.code === "PGRST204" || withInvoice.error?.code === "42703") {
    await supabase.from("billing_events").insert({
      org_id: row.org_id,
      provider: row.provider,
      event_type: row.event_type,
      external_id: row.external_id,
      payload: row.payload,
    });
  } else if (withInvoice.error) {
    console.error("[stripe billing] event insert failed", withInvoice.error.message);
  }

  invalidateOrgUsageCache(options.orgId);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveOrgIdFromStripeObject(obj: Record<string, unknown>): string | null {
  const meta = (obj.metadata || {}) as Record<string, unknown>;
  const fromMeta = typeof meta.org_id === "string" ? meta.org_id.trim() : "";
  if (UUID_RE.test(fromMeta)) return fromMeta;
  const ref = typeof obj.client_reference_id === "string" ? obj.client_reference_id.trim() : "";
  return UUID_RE.test(ref) ? ref : null;
}

export function resolvePlanTierFromStripeObject(obj: Record<string, unknown>): PlanTier {
  const meta = (obj.metadata || {}) as Record<string, unknown>;
  const raw = typeof meta.plan_tier === "string" ? meta.plan_tier : "starter";
  const tier = normalizePlanTier(raw);
  return tier === "free" || tier === "enterprise" ? "starter" : tier;
}

/** Display helper — catalogue USD labels. */
export function stripeDisplayPriceUsd(tier: "starter" | "pro"): number | null {
  return PLAN_CATALOG[tier].priceUsd;
}
