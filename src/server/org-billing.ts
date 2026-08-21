/**
 * Org billing: usage summary, BYOK OpenAI key, Razorpay checkout.
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
import {
  getOrgUsageSnapshot,
  invalidateOrgUsageCache,
  loadOrgOpenAiKey,
} from "@/server/org-usage";
import { recordAuditEvent } from "@/server/audit-log";
import { requireStaffUser } from "@/server/staff-auth";
import { stripeConfigured } from "@/server/org-billing-stripe";

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

function appBaseUrl(): string {
  return String(process.env.VITE_APP_URL || "http://localhost:8080").replace(/\/$/, "");
}

function razorpayConfigured(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID &&
      process.env.RAZORPAY_KEY_SECRET &&
      (process.env.RAZORPAY_PLAN_STARTER || process.env.RAZORPAY_PLAN_PRO),
  );
}

function razorpayAuthHeader(): string {
  const id = process.env.RAZORPAY_KEY_ID!;
  const secret = process.env.RAZORPAY_KEY_SECRET!;
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

function razorpayPlanId(tier: Exclude<PlanTier, "free" | "enterprise">): string | null {
  if (tier === "starter") return process.env.RAZORPAY_PLAN_STARTER || null;
  if (tier === "pro") return process.env.RAZORPAY_PLAN_PRO || null;
  return null;
}

export type BillingSummary = {
  planTier: PlanTier;
  planLabel: string;
  billingStatus: string;
  billingPeriodEnd: string | null;
  hasOwnOpenAiKey: boolean;
  openAiKeyHint: string | null;
  usage: {
    aiSpendInr: number;
    whatsappMessages: number;
    seatsUsed: number;
    pendingInvites: number;
  };
  limits: {
    monthlyAiSpendCapInr: number | null;
    monthlyWhatsAppCap: number | null;
    maxSeats: number | null;
  };
  plans: Array<{
    tier: PlanTier;
    label: string;
    priceInr: number | null;
    priceUsd: number | null;
    monthlyAiSpendCapInr: number | null;
    monthlyWhatsAppCap: number | null;
    maxSeats: number | null;
    current: boolean;
  }>;
  razorpayConfigured: boolean;
  stripeConfigured: boolean;
  trialActive: boolean;
  trialEndsAt: string | null;
  /** Caps exceeded but still served until this time. */
  usageGraceUntil: string | null;
  /** Past due but still served until this time. */
  pastDueGraceUntil: string | null;
  /** Limits come from a contract, so the plan cards do not describe them. */
  hasCustomLimits: boolean;
  invoices: BillingInvoice[];
};

export const getOrgBillingSummary = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await requireAdmin();
  const snap = await getOrgUsageSnapshot(auth.profile.org_id, { fresh: true });
  const [key, invoices] = await Promise.all([
    loadOrgOpenAiKey(auth.profile.org_id),
    loadBillingInvoices(auth.profile.org_id),
  ]);

  const tiers: PlanTier[] = ["free", "starter", "pro", "enterprise"];
  return {
    planTier: snap.planTier,
    planLabel: snap.planLabel,
    billingStatus: snap.billingStatus,
    billingPeriodEnd: snap.billingPeriodEnd,
    hasOwnOpenAiKey: snap.hasOwnOpenAiKey,
    openAiKeyHint: key ? `sk-…${key.slice(-4)}` : null,
    usage: {
      aiSpendInr: snap.aiSpendInr,
      whatsappMessages: snap.whatsappMessages,
      seatsUsed: snap.seatsUsed,
      pendingInvites: snap.pendingInvites,
    },
    limits: snap.limits,
    plans: tiers.map((tier) => ({
      tier,
      label: PLAN_CATALOG[tier].label,
      priceInr: PLAN_CATALOG[tier].priceInr,
      priceUsd: PLAN_CATALOG[tier].priceUsd,
      monthlyAiSpendCapInr: PLAN_CATALOG[tier].monthlyAiSpendCapInr,
      monthlyWhatsAppCap: PLAN_CATALOG[tier].monthlyWhatsAppCap,
      maxSeats: PLAN_CATALOG[tier].maxSeats,
      current: tier === snap.planTier,
    })),
    razorpayConfigured: razorpayConfigured(),
    stripeConfigured: stripeConfigured(),
    trialActive: snap.trialActive,
    trialEndsAt: snap.trialEndsAt,
    usageGraceUntil: snap.usageGraceUntil,
    pastDueGraceUntil: snap.pastDueGraceUntil,
    hasCustomLimits: snap.hasCustomLimits,
    invoices,
  } satisfies BillingSummary;
});

export const saveOrgOpenAiKey = createServerFn({ method: "POST" })
  .validator(z.object({ apiKey: z.string().min(20).max(200) }))
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    const apiKey = data.apiKey.trim();
    if (!apiKey.startsWith("sk-")) {
      throw new Error("OpenAI API keys start with sk-");
    }

    const supabase = createServiceSupabase();
    const { error } = await supabase.from("org_secrets").upsert(
      {
        org_id: auth.profile.org_id,
        openai_api_key: apiKey,
        updated_by: auth.profile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id" },
    );
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        throw new Error("Run 041_billing.sql in Supabase first.");
      }
      throw new Error(error.message);
    }
    invalidateOrgUsageCache(auth.profile.org_id);
    void recordAuditEvent({
      orgId: auth.profile.org_id,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "billing.openai_key_save",
      resourceType: "org_secrets",
      resourceId: auth.profile.org_id,
    });
    return { ok: true as const, hint: `sk-…${apiKey.slice(-4)}` };
  });

export const removeOrgOpenAiKey = createServerFn({ method: "POST" }).handler(async () => {
  const auth = await requireAdmin();
  const supabase = createServiceSupabase();
  const { error } = await supabase.from("org_secrets").delete().eq("org_id", auth.profile.org_id);
  if (error && error.code !== "42P01" && error.code !== "PGRST205") {
    throw new Error(error.message);
  }
  invalidateOrgUsageCache(auth.profile.org_id);
  void recordAuditEvent({
    orgId: auth.profile.org_id,
    actorId: auth.profile.id,
    actorEmail: auth.profile.email,
    action: "billing.openai_key_remove",
    resourceType: "org_secrets",
    resourceId: auth.profile.org_id,
  });
  return { ok: true as const };
});

export const createRazorpayCheckout = createServerFn({ method: "POST" })
  .validator(z.object({ planTier: z.enum(["starter", "pro"]) }))
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    if (!razorpayConfigured()) {
      throw new Error(
        "Razorpay is not configured on the server. Contact support to upgrade, or set RAZORPAY_* env vars.",
      );
    }

    const planId = razorpayPlanId(data.planTier);
    if (!planId) {
      throw new Error(`Razorpay plan ID missing for ${data.planTier}. Set RAZORPAY_PLAN_${data.planTier.toUpperCase()}.`);
    }

    const supabase = createServiceSupabase();
    const { data: org } = await supabase
      .from("organizations")
      .select("razorpay_subscription_id, billing_status")
      .eq("id", auth.profile.org_id)
      .maybeSingle();

    if (org?.razorpay_subscription_id && org.billing_status === "active") {
      throw new Error(`You are already on ${planLabelForTier(normalizePlanTier(data.planTier))}. Manage billing in Razorpay.`);
    }

    const res = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        Authorization: razorpayAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan_id: planId,
        total_count: 12,
        customer_notify: 1,
        notes: {
          org_id: auth.profile.org_id,
          plan_tier: data.planTier,
          admin_email: auth.profile.email,
        },
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      short_url?: string;
      error?: { description?: string; code?: string };
    };

    if (!res.ok) {
      throw new Error(json.error?.description || `Razorpay error (${res.status})`);
    }

    if (json.id) {
      await supabase
        .from("organizations")
        .update({ razorpay_subscription_id: json.id })
        .eq("id", auth.profile.org_id);
    }

    void recordAuditEvent({
      orgId: auth.profile.org_id,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "billing.checkout",
      resourceType: "subscription",
      resourceId: json.id || undefined,
      metadata: { planTier: data.planTier },
    });

    if (!json.short_url) {
      throw new Error("Razorpay did not return a checkout URL.");
    }

    return {
      ok: true as const,
      checkoutUrl: json.short_url,
      subscriptionId: json.id || null,
    };
  });

/** Called from Razorpay webhook — service role only. */
export async function applyRazorpayBillingUpdate(options: {
  orgId: string;
  planTier?: PlanTier;
  billingStatus?: "active" | "past_due" | "cancelled";
  subscriptionId?: string | null;
  customerId?: string | null;
  periodEnd?: string | null;
  eventType: string;
  externalId?: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const supabase = createServiceSupabase();
  const patch: Record<string, unknown> = {};
  if (options.planTier) {
    patch.plan_tier = options.planTier;
    patch.plan = planLabelForTier(options.planTier);
  }
  if (options.billingStatus) patch.billing_status = options.billingStatus;
  if (options.subscriptionId !== undefined) patch.razorpay_subscription_id = options.subscriptionId;
  if (options.customerId) patch.razorpay_customer_id = options.customerId;
  if (options.periodEnd) patch.billing_period_end = options.periodEnd;
  // Payment recovered: drop the past-due clock so a later lapse gets a fresh grace window.
  if (options.billingStatus === "active") patch.past_due_since = null;

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("organizations").update(patch).eq("id", options.orgId);
    if (error) {
      if (error.code === "PGRST204" || error.code === "42703") {
        delete patch.past_due_since;
        const retry = await supabase.from("organizations").update(patch).eq("id", options.orgId);
        if (retry.error) throw new Error(retry.error.message);
      } else {
        throw new Error(error.message);
      }
    }
  }

  if (options.billingStatus === "past_due") {
    // Only the first failure starts the clock, so retries do not extend the grace window.
    const started = await supabase
      .from("organizations")
      .update({ past_due_since: new Date().toISOString() })
      .eq("id", options.orgId)
      .is("past_due_since", null);
    if (started.error && !["PGRST204", "42703"].includes(started.error.code || "")) {
      console.error("[billing] could not stamp past_due_since", started.error.message);
    }
  }

  const row = {
    org_id: options.orgId,
    provider: "razorpay",
    event_type: options.eventType,
    external_id: options.externalId || null,
    payload: options.payload,
  };
  const invoice = extractInvoiceDetail(options.payload);
  const withInvoice = await supabase.from("billing_events").insert({ ...row, ...invoice });
  // Pre-045 databases lack the invoice columns; the event itself still matters.
  if (withInvoice.error?.code === "PGRST204" || withInvoice.error?.code === "42703") {
    await supabase.from("billing_events").insert(row);
  } else if (withInvoice.error) {
    console.error("[billing] event insert failed", withInvoice.error.message);
  }

  invalidateOrgUsageCache(options.orgId);
}

/**
 * Payment detail for the invoice list. Razorpay sends amounts in paise, and puts the
 * charge under `payment`, `invoice`, or `subscription` depending on the event.
 */
function extractInvoiceDetail(payload: Record<string, unknown>): {
  amount: number | null;
  currency: string | null;
  invoice_id: string | null;
  status: string | null;
} {
  const sub = (payload.payload || {}) as Record<string, unknown>;
  const entity = (
    (sub.payment as { entity?: Record<string, unknown> } | undefined)?.entity ||
    (sub.invoice as { entity?: Record<string, unknown> } | undefined)?.entity ||
    (sub.subscription as { entity?: Record<string, unknown> } | undefined)?.entity ||
    {}
  ) as Record<string, unknown>;

  const paise = Number(entity.amount_paid ?? entity.amount ?? NaN);
  const invoiceId =
    (sub.invoice as { entity?: { id?: string } } | undefined)?.entity?.id ||
    (typeof entity.invoice_id === "string" ? entity.invoice_id : null);

  return {
    amount: Number.isFinite(paise) ? Math.round(paise) / 100 : null,
    currency: typeof entity.currency === "string" ? entity.currency : null,
    invoice_id: invoiceId || null,
    status: typeof entity.status === "string" ? entity.status : null,
  };
}

export type BillingInvoice = {
  id: string;
  eventType: string;
  amount: number | null;
  currency: string;
  invoiceId: string | null;
  status: string | null;
  createdAt: string;
};

const INVOICE_EVENT_TYPES = [
  "subscription.charged",
  "invoice.paid",
  "payment.captured",
  "payment.failed",
  "invoice.payment_failed",
  "checkout.session.completed",
];

/** Payment history for one workspace. Service role — callers must authorize first. */
export async function loadBillingInvoices(orgId: string, limit = 24): Promise<BillingInvoice[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("billing_events")
    .select("id, event_type, amount, currency, invoice_id, status, created_at")
    .eq("org_id", orgId)
    .in("event_type", INVOICE_EVENT_TYPES)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    // Missing table or pre-045 columns: an empty history is the honest answer.
    if (["42P01", "PGRST205", "42703", "PGRST204"].includes(error.code || "")) return [];
    throw new Error(error.message);
  }
  return (data || []).map((r) => ({
    id: String(r.id),
    eventType: String(r.event_type),
    amount: r.amount == null ? null : Number(r.amount),
    currency: String(r.currency || "INR"),
    invoiceId: r.invoice_id ? String(r.invoice_id) : null,
    status: r.status ? String(r.status) : null,
    createdAt: String(r.created_at),
  }));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Workspace that a Razorpay event belongs to, taken from `notes.org_id` set at checkout.
 * Only trustworthy on a signature-verified payload — the webhook rejects unsigned events.
 */
export function resolveOrgIdFromRazorpayPayload(payload: Record<string, unknown>): string | null {
  const sub = payload.payload as Record<string, unknown> | undefined;
  const entity =
    (sub?.subscription as Record<string, unknown> | undefined) ||
    (sub?.payment as Record<string, unknown> | undefined)?.subscription ||
    sub?.entity;
  const notes =
    (entity as { notes?: Record<string, string> } | undefined)?.notes ||
    (payload.payload as { subscription?: { entity?: { notes?: Record<string, string> } } })?.subscription
      ?.entity?.notes;
  const orgId = typeof notes?.org_id === "string" ? notes.org_id.trim() : "";
  return UUID_RE.test(orgId) ? orgId : null;
}

export { appBaseUrl };
