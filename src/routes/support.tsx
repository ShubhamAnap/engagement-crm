import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import {
  PRODUCT_NAME,
  SUPPORT_EMAIL,
  SUPPORT_SLA_GLOBAL,
  SUPPORT_SLA_INDIA,
} from "@/lib/public-site";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: `Support — ${PRODUCT_NAME}` },
      { name: "description", content: "Support channels and response SLAs for Engage CRM customers." },
    ],
  }),
  component: SupportPage,
});

function SupportPage() {
  return (
    <MarketingShell>
      <p className="text-[11px] font-semibold tracking-[0.18em] text-primary uppercase">Support</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">How we help</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Email is the primary channel. Paid plans may get a WhatsApp support line on request. Check{" "}
        <Link to="/status" className="text-primary hover:underline">
          service status
        </Link>{" "}
        before reporting an outage.
      </p>

      <div className="mt-8 space-y-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">{SUPPORT_SLA_INDIA.region}</h2>
          <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
            <div className="flex justify-between gap-4">
              <dt>Hours</dt>
              <dd className="text-right text-foreground">{SUPPORT_SLA_INDIA.hours}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>First response</dt>
              <dd className="text-right text-foreground">{SUPPORT_SLA_INDIA.firstResponse}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Channels</dt>
              <dd className="text-right text-foreground">{SUPPORT_SLA_INDIA.channels.join(", ")}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">{SUPPORT_SLA_GLOBAL.region}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            For workspaces outside India once Stripe / global billing is enabled.
          </p>
          <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
            <div className="flex justify-between gap-4">
              <dt>Hours</dt>
              <dd className="text-right text-foreground">{SUPPORT_SLA_GLOBAL.hours}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>First response</dt>
              <dd className="text-right text-foreground">{SUPPORT_SLA_GLOBAL.firstResponse}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Channels</dt>
              <dd className="text-right text-foreground">{SUPPORT_SLA_GLOBAL.channels.join(", ")}</dd>
            </div>
          </dl>
        </div>
      </div>

      <p className="mt-8 text-sm">
        Contact:{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-primary hover:underline">
          {SUPPORT_EMAIL}
        </a>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Include your workspace name, admin email, and a short description. For billing disputes see{" "}
        <Link to="/terms" className="text-primary hover:underline">
          Terms §4
        </Link>
        .
      </p>
    </MarketingShell>
  );
}
