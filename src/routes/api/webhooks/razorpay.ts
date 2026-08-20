import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  applyRazorpayBillingUpdate,
  resolveOrgIdFromRazorpayPayload,
} from "@/server/org-billing";
import { normalizePlanTier, type PlanTier } from "@/lib/plans";

export const Route = createFileRoute("/api/webhooks/razorpay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const rawBody = await request.text();

        if (secret) {
          const signature = request.headers.get("x-razorpay-signature") || "";
          const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
          try {
            const a = Buffer.from(expected, "utf8");
            const b = Buffer.from(signature, "utf8");
            if (a.length !== b.length || !timingSafeEqual(a, b)) {
              return Response.json({ error: "Invalid signature" }, { status: 401 });
            }
          } catch {
            return Response.json({ error: "Invalid signature" }, { status: 401 });
          }
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const event = String(payload.event || "");
        const orgId = resolveOrgIdFromRazorpayPayload(payload);

        if (!orgId) {
          console.warn("[razorpay webhook] missing org_id in notes", event);
          return Response.json({ ok: true, skipped: "no org_id" });
        }

        try {
          if (event === "subscription.activated" || event === "subscription.charged") {
            const tierRaw =
              (payload.payload as { subscription?: { entity?: { notes?: { plan_tier?: string } } } })
                ?.subscription?.entity?.notes?.plan_tier || "starter";
            const tier = normalizePlanTier(tierRaw) as PlanTier;
            const subEntity = (payload.payload as { subscription?: { entity?: Record<string, unknown> } })
              ?.subscription?.entity;
            await applyRazorpayBillingUpdate({
              orgId,
              planTier: tier === "free" ? "starter" : tier,
              billingStatus: "active",
              subscriptionId: String(subEntity?.id || ""),
              customerId: typeof subEntity?.customer_id === "string" ? subEntity.customer_id : undefined,
              periodEnd:
                typeof subEntity?.current_end === "number"
                  ? new Date(subEntity.current_end * 1000).toISOString()
                  : null,
              eventType: event,
              externalId: String(subEntity?.id || ""),
              payload,
            });
          } else if (event === "subscription.cancelled" || event === "subscription.completed") {
            await applyRazorpayBillingUpdate({
              orgId,
              planTier: "free",
              billingStatus: "cancelled",
              eventType: event,
              payload,
            });
          } else if (event === "subscription.pending" || event === "payment.failed") {
            await applyRazorpayBillingUpdate({
              orgId,
              billingStatus: "past_due",
              eventType: event,
              payload,
            });
          }
        } catch (err) {
          console.error("[razorpay webhook]", err);
          return Response.json({ error: "Handler failed" }, { status: 500 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
