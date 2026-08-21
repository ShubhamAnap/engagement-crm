import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalShell } from "@/components/legal/LegalShell";
import { PRODUCT_NAME, SUPPORT_EMAIL } from "@/lib/public-site";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [{ title: "Terms of Service" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="21 August 2026">
      <section className="space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          These Terms of Service (&quot;Terms&quot;) govern your access to and use of {PRODUCT_NAME}{" "}
          (&quot;Service&quot;). By creating an account or using the Service, you agree to these Terms.
        </p>

        <h2 className="text-base font-semibold text-foreground">1. The Service</h2>
        <p>
          {PRODUCT_NAME} is a multi-tenant customer engagement platform offered as a subscription SaaS.
          Each workspace (organization) is logically isolated. You are responsible for content,
          messages, and data you upload or send through connected channels (WhatsApp, email, social,
          etc.). The Service is not a sale of source code or exclusive IP.
        </p>

        <h2 className="text-base font-semibold text-foreground">2. Accounts &amp; access</h2>
        <p>
          You must provide accurate registration information and keep credentials secure. Workspace
          admins control team invites and permissions. We may suspend access for abuse, non-payment,
          or legal compliance.
        </p>

        <h2 className="text-base font-semibold text-foreground">3. Acceptable use</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>No spam, unlawful messages, or harassment via any channel.</li>
          <li>No attempt to bypass usage limits, access other tenants&apos; data, or probe systems.</li>
          <li>Comply with Meta/WhatsApp, email, and applicable telecom/commerce regulations.</li>
          <li>AI-generated replies must be reviewed where accuracy or compliance requires it.</li>
        </ul>

        <h2 className="text-base font-semibold text-foreground">4. Plans, billing &amp; refunds</h2>
        <p>
          Free and paid plans include usage caps (AI spend, WhatsApp messages, seats) as shown in
          Settings → Billing and on the{" "}
          <Link to="/pricing" className="text-primary hover:underline">
            pricing page
          </Link>
          . Over-limit usage may enter a short grace window, then be blocked until upgrade or period
          reset. Paid subscriptions in India are billed via Razorpay (INR). International workspaces
          may be billed via Stripe (USD) when enabled.
        </p>
        <p>
          <strong className="text-foreground">Refunds:</strong> Monthly fees are generally
          non-refundable once a billing period starts. If a charge was made in error, contact{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">
            {SUPPORT_EMAIL}
          </a>{" "}
          within 7 days; approved refunds are issued to the original payment method. Statutory rights
          that cannot be waived remain unaffected.
        </p>

        <h2 className="text-base font-semibold text-foreground">5. Data &amp; privacy</h2>
        <p>
          Our handling of personal data is described in the{" "}
          <Link to="/privacy" className="text-primary hover:underline">
            Privacy Policy
          </Link>
          . Enterprise / GDPR customers may also rely on the{" "}
          <Link to="/dpa" className="text-primary hover:underline">
            Data Processing Addendum
          </Link>
          . You are the data controller for your customers&apos; and leads&apos; data; we process it
          on your instructions to provide the Service.
        </p>

        <h2 className="text-base font-semibold text-foreground">6. Availability &amp; support</h2>
        <p>
          We aim for high availability but do not guarantee uninterrupted service. Maintenance,
          third-party API outages (OpenAI, Meta, etc.), or force majeure may affect features. Support
          SLAs are published on the{" "}
          <Link to="/support" className="text-primary hover:underline">
            Support
          </Link>{" "}
          page.
        </p>

        <h2 className="text-base font-semibold text-foreground">7. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, we are not liable for indirect, incidental, or
          consequential damages, or for loss of profits or data. Our aggregate liability is limited
          to fees paid by you in the twelve months before the claim.
        </p>

        <h2 className="text-base font-semibold text-foreground">8. Changes &amp; termination</h2>
        <p>
          We may update these Terms; material changes will be communicated via email or in-app
          notice. You may disable your workspace at any time. We may terminate accounts that violate
          these Terms.
        </p>

        <h2 className="text-base font-semibold text-foreground">9. Contact</h2>
        <p>
          Questions:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">
            {SUPPORT_EMAIL}
          </a>
        </p>
      </section>
    </LegalShell>
  );
}
