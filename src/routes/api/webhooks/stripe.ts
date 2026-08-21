import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  applyStripeBillingUpdate,
  resolveOrgIdFromStripeObject,
  resolvePlanTierFromStripeObject,
} from "@/server/org-billing-stripe";

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);
}

function verifyStripeSignature(rawBody: string, header: string, secret: string): boolean {
  // Stripe-Signature: t=timestamp,v1=signature
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, ...rest] = p.trim().split("=");
      return [k, rest.join("=")];
    }),
  ) as Record<string, string>;
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const ageSec = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(Number(t)) || ageSec > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(v1, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Stripe billing events (Phase 2 USD).
 * Subscribe to: checkout.session.completed, customer.subscription.updated/deleted,
 * invoice.paid, invoice.payment_failed.
 */
export const Route = createFileRoute("/api/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
        const rawBody = await request.text();

        if (!secret) {
          if (isProductionRuntime()) {
            console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET unset — rejecting");
            return Response.json({ error: "Webhook not configured" }, { status: 403 });
          }
          console.warn("[stripe webhook] secret unset — accepting (non-production)");
        } else {
          const header = request.headers.get("stripe-signature") || "";
          if (!verifyStripeSignature(rawBody, header, secret)) {
            return Response.json({ error: "Invalid signature" }, { status: 401 });
          }
        }

        let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
        try {
          event = JSON.parse(rawBody) as typeof event;
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const type = String(event.type || "");
        const obj = (event.data?.object || {}) as Record<string, unknown>;
        const orgId = resolveOrgIdFromStripeObject(obj);

        // Subscription objects nest metadata; checkout sessions use client_reference_id.
        let resolvedOrg = orgId;
        if (!resolvedOrg && obj.object === "subscription") {
          resolvedOrg = resolveOrgIdFromStripeObject(obj);
        }
        if (!resolvedOrg && typeof obj.subscription === "string") {
          // invoice events — org may only be on subscription metadata; try invoice metadata
          resolvedOrg = resolveOrgIdFromStripeObject(obj);
        }

        if (!resolvedOrg) {
          console.warn("[stripe webhook] missing org_id", type);
          return Response.json({ ok: true, skipped: "no org_id" });
        }

        try {
          if (type === "checkout.session.completed") {
            const tier = resolvePlanTierFromStripeObject(obj);
            await applyStripeBillingUpdate({
              orgId: resolvedOrg,
              planTier: tier,
              billingStatus: "active",
              subscriptionId: typeof obj.subscription === "string" ? obj.subscription : null,
              customerId: typeof obj.customer === "string" ? obj.customer : null,
              eventType: type,
              externalId: typeof event.id === "string" ? event.id : undefined,
              payload: obj,
            });
          } else if (type === "customer.subscription.updated") {
            const status = String(obj.status || "");
            const tier = resolvePlanTierFromStripeObject(obj);
            const periodEnd =
              typeof obj.current_period_end === "number"
                ? new Date(obj.current_period_end * 1000).toISOString()
                : null;
            await applyStripeBillingUpdate({
              orgId: resolvedOrg,
              planTier: tier,
              billingStatus:
                status === "active" || status === "trialing"
                  ? "active"
                  : status === "past_due"
                    ? "past_due"
                    : status === "canceled" || status === "unpaid"
                      ? "cancelled"
                      : undefined,
              subscriptionId: typeof obj.id === "string" ? obj.id : null,
              customerId: typeof obj.customer === "string" ? obj.customer : null,
              periodEnd,
              eventType: type,
              externalId: typeof event.id === "string" ? event.id : undefined,
              payload: obj,
            });
          } else if (type === "customer.subscription.deleted") {
            await applyStripeBillingUpdate({
              orgId: resolvedOrg,
              planTier: "free",
              billingStatus: "cancelled",
              subscriptionId: null,
              eventType: type,
              externalId: typeof event.id === "string" ? event.id : undefined,
              payload: obj,
            });
          } else if (type === "invoice.paid" || type === "invoice.payment_failed") {
            const cents = Number(obj.amount_paid ?? obj.amount_due ?? NaN);
            await applyStripeBillingUpdate({
              orgId: resolvedOrg,
              billingStatus: type === "invoice.paid" ? "active" : "past_due",
              eventType: type,
              externalId: typeof obj.id === "string" ? obj.id : event.id,
              payload: obj,
              amount: Number.isFinite(cents) ? Math.round(cents) / 100 : null,
              currency: typeof obj.currency === "string" ? obj.currency : "usd",
            });
          }
        } catch (err) {
          console.error("[stripe webhook] handler error", err);
          return Response.json({ error: "Handler failed" }, { status: 500 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
