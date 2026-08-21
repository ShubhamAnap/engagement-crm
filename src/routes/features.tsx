import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import { DEMO_VIDEO_URL, MARKETING_FEATURES, PRODUCT_NAME, SALES_EMAIL } from "@/lib/public-site";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: `${PRODUCT_NAME} — Shared inbox & AI for growing teams` },
      {
        name: "description",
        content:
          "Multi-tenant WhatsApp inbox, AI replies, leads, and billing — onboard organizations across India, expand worldwide when ready.",
      },
    ],
  }),
  component: FeaturesPage,
});

function FeaturesPage() {
  return (
    <MarketingShell wide>
      <section className="max-w-2xl">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-primary uppercase">
          {PRODUCT_NAME}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Customer conversations, one workspace
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Public SaaS for Indian SMBs first — shared inbox, AI assist, and light CRM. Each organization
          signs up, connects their channels, and invites their team. No codebase sale; subscriptions
          only.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg" className="rounded-xl px-6">
            <Link to="/signup">Start free</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="rounded-xl px-6">
            <Link to="/pricing">See pricing</Link>
          </Button>
          {DEMO_VIDEO_URL ? (
            <Button asChild size="lg" variant="ghost" className="rounded-xl px-6">
              <a href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer">
                Watch demo
              </a>
            </Button>
          ) : null}
        </div>
      </section>

      <section className="mt-14">
        <h2 className="text-lg font-semibold text-foreground">What you get</h2>
        <p className="mt-1 text-sm text-muted-foreground">One job per surface — inbox, AI, leads, billing.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MARKETING_FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-card/80 p-5">
              <h3 className="text-sm font-semibold text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-14 rounded-2xl border border-border bg-primary/5 p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-foreground">India now · worldwide next</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Self-serve signup and Razorpay (INR) are live for India. Stripe (USD) and a GDPR/DPA pack
          are ready for cross-border orgs once your team is ready — same product, more markets.
        </p>
        <p className="mt-4 text-sm">
          Sales:{" "}
          <a href={`mailto:${SALES_EMAIL}`} className="font-medium text-primary hover:underline">
            {SALES_EMAIL}
          </a>
        </p>
      </section>
    </MarketingShell>
  );
}
