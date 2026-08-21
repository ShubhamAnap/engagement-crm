import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalShell } from "@/components/legal/LegalShell";
import { PRIVACY_EMAIL, PRODUCT_NAME, SUPPORT_EMAIL } from "@/lib/public-site";

export const Route = createFileRoute("/dpa")({
  head: () => ({
    meta: [
      { title: `Data Processing Addendum — ${PRODUCT_NAME}` },
      {
        name: "description",
        content: "DPA for customers who need GDPR-style processor terms when using Engage CRM.",
      },
    ],
  }),
  component: DpaPage,
});

function DpaPage() {
  return (
    <LegalShell title="Data Processing Addendum" updated="21 August 2026">
      <section className="space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          This Data Processing Addendum (&quot;DPA&quot;) forms part of the{" "}
          <Link to="/terms" className="text-primary hover:underline">
            Terms of Service
          </Link>{" "}
          between the customer (&quot;Controller&quot;) and the operator of {PRODUCT_NAME}{" "}
          (&quot;Processor&quot;). It applies when the Processor processes personal data on behalf of
          the Controller in connection with the Service.
        </p>

        <h2 className="text-base font-semibold text-foreground">1. Roles</h2>
        <p>
          The customer determines the purposes of processing customer, lead, and conversation data
          (Controller). We process that data only to provide the Service (Processor), except where we
          act as an independent controller for account billing and product analytics as described in
          the{" "}
          <Link to="/privacy" className="text-primary hover:underline">
            Privacy Policy
          </Link>
          .
        </p>

        <h2 className="text-base font-semibold text-foreground">2. Nature of processing</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Hosting inbox messages, contacts, leads, and knowledge documents you upload.</li>
          <li>Routing messages via Meta, email, and other channels you connect.</li>
          <li>Optional AI inference via OpenAI (or your BYOK key) on content you submit.</li>
          <li>Billing, abuse prevention, and security logging.</li>
        </ul>

        <h2 className="text-base font-semibold text-foreground">3. Subprocessors</h2>
        <p>
          Current core subprocessors include Supabase (database/auth), Render (hosting), OpenAI (AI,
          unless BYOK), Meta/Google (messaging), Razorpay and/or Stripe (payments), and email
          delivery providers. We will notify material subprocessor changes via email or in-app notice
          where required.
        </p>

        <h2 className="text-base font-semibold text-foreground">4. Security &amp; location</h2>
        <p>
          Data is stored in the Supabase region configured for this deployment (document your region
          for customers). We use encryption in transit, tenant isolation (RLS), and access controls.
          International customers should confirm the region meets their residency requirements before
          onboarding EU personal data at scale.
        </p>

        <h2 className="text-base font-semibold text-foreground">5. Assistance</h2>
        <p>
          We will reasonably assist with data subject requests, security incidents affecting your
          workspace, and deletion/export after account closure, subject to our retention windows and
          legal obligations.
        </p>

        <h2 className="text-base font-semibold text-foreground">6. Contact</h2>
        <p>
          Privacy / DPA:{" "}
          <a href={`mailto:${PRIVACY_EMAIL}`} className="text-primary hover:underline">
            {PRIVACY_EMAIL}
          </a>
          . General support:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">
            {SUPPORT_EMAIL}
          </a>
          . Enterprise customers may request a signed PDF DPA via sales.
        </p>
      </section>
    </LegalShell>
  );
}
