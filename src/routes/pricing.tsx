import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import { PLAN_CATALOG, type PlanTier } from "@/lib/plans";
import { formatInr } from "@/lib/spend-math";
import { DEMO_VIDEO_URL, PRODUCT_NAME, SALES_EMAIL } from "@/lib/public-site";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: `Pricing — ${PRODUCT_NAME}` },
      {
        name: "description",
        content: "India INR plans via Razorpay. USD Stripe checkout for international teams when enabled.",
      },
    ],
  }),
  component: PricingPage,
});

const ORDER: PlanTier[] = ["free", "starter", "pro", "enterprise"];

function PricingPage() {
  return (
    <MarketingShell wide>
      <div className="max-w-2xl">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-primary uppercase">Pricing</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Plans for India-first teams
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Start free, upgrade when WhatsApp volume or AI spend grows. Self-serve checkout uses Razorpay
          (INR). International USD billing via Stripe is available when enabled for your workspace —
          otherwise email {SALES_EMAIL}.
        </p>
        {DEMO_VIDEO_URL ? (
          <p className="mt-3 text-sm">
            <a href={DEMO_VIDEO_URL} className="font-medium text-primary hover:underline" target="_blank" rel="noreferrer">
              Watch the 3-minute product walkthrough →
            </a>
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Prefer a live demo? Email{" "}
            <a href={`mailto:${SALES_EMAIL}`} className="text-primary hover:underline">
              {SALES_EMAIL}
            </a>
            .
          </p>
        )}
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ORDER.map((tier) => {
          const plan = PLAN_CATALOG[tier];
          const highlight = tier === "starter";
          return (
            <div
              key={tier}
              className={`flex flex-col rounded-2xl border p-5 ${
                highlight
                  ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                  : "border-border bg-card"
              }`}
            >
              <p className="text-sm font-semibold text-foreground">{plan.label}</p>
              <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">
                {plan.priceInr == null
                  ? "Custom"
                  : plan.priceInr === 0
                    ? "₹0"
                    : formatInr(plan.priceInr)}
                {plan.priceInr != null ? (
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                ) : null}
              </p>
              {plan.priceUsd != null && plan.priceUsd > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  or ~${plan.priceUsd}/mo USD when Stripe is on
                </p>
              ) : plan.priceInr == null ? (
                <p className="mt-1 text-xs text-muted-foreground">Negotiated caps &amp; SLA</p>
              ) : null}
              <ul className="mt-4 flex-1 space-y-1.5 text-xs text-muted-foreground">
                <li>
                  AI:{" "}
                  {plan.monthlyAiSpendCapInr == null
                    ? "Unlimited"
                    : `${formatInr(plan.monthlyAiSpendCapInr)}/mo`}
                </li>
                <li>
                  WhatsApp:{" "}
                  {plan.monthlyWhatsAppCap == null
                    ? "Unlimited"
                    : `${plan.monthlyWhatsAppCap.toLocaleString("en-IN")}/mo`}
                </li>
                <li>Seats: {plan.maxSeats == null ? "Unlimited" : plan.maxSeats}</li>
              </ul>
              {tier === "enterprise" ? (
                <Button asChild variant="outline" className="mt-5 w-full">
                  <a href={`mailto:${SALES_EMAIL}?subject=Engage%20Enterprise`}>Contact sales</a>
                </Button>
              ) : (
                <Button asChild className="mt-5 w-full" variant={highlight ? "default" : "outline"}>
                  <Link to="/signup">{tier === "free" ? "Create workspace" : "Start free, upgrade later"}</Link>
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        Prices exclude Meta WhatsApp conversation fees and your own OpenAI BYOK usage. See{" "}
        <Link to="/terms" className="text-primary hover:underline">
          Terms
        </Link>{" "}
        for refunds and acceptable use.
      </p>
    </MarketingShell>
  );
}
