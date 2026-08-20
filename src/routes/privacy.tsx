import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalShell } from "@/components/legal/LegalShell";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [{ title: "Privacy Policy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="20 August 2026">
      <section className="space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          EnerTech UPS Pvt. Ltd. (&quot;we&quot;) operates Engage CRM. This Privacy Policy explains
          how we collect, use, and protect information when you use our Service.
        </p>

        <h2 className="text-base font-semibold text-foreground">1. Information we collect</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-foreground">Account data:</strong> name, email, phone, organization
            name, role, and authentication identifiers.
          </li>
          <li>
            <strong className="text-foreground">Workspace data:</strong> leads, customers,
            conversations, products, knowledge documents, and channel configuration you provide.
          </li>
          <li>
            <strong className="text-foreground">Usage data:</strong> API spend logs, feature usage,
            audit events, and technical logs (IP, browser, errors).
          </li>
          <li>
            <strong className="text-foreground">Payment data:</strong> processed by Razorpay; we store
            subscription IDs and plan status, not full card numbers.
          </li>
        </ul>

        <h2 className="text-base font-semibold text-foreground">2. How we use information</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Provide, secure, and improve the Service.</li>
          <li>Enforce plan limits, billing, and prevent abuse.</li>
          <li>Send transactional email (invites, password reset, billing notices).</li>
          <li>Process AI requests via OpenAI or your own API key when configured.</li>
        </ul>

        <h2 className="text-base font-semibold text-foreground">3. Sharing</h2>
        <p>
          We share data with subprocessors needed to operate the Service: Supabase (database/auth),
          Render (hosting), OpenAI (AI), Meta/Google (messaging channels), Razorpay (payments), and
          email delivery providers. We do not sell personal data. We may disclose data if required by
          law or to protect rights and safety.
        </p>

        <h2 className="text-base font-semibold text-foreground">4. Retention</h2>
        <p>
          We retain workspace data while your account is active. You may export core data from
          Settings. After workspace disable or deletion, data is retained for a limited period for
          backup/legal purposes then deleted or anonymized.
        </p>

        <h2 className="text-base font-semibold text-foreground">5. Security</h2>
        <p>
          We use encryption in transit, row-level security per organization, isolated storage paths,
          and access controls. No method is 100% secure; report concerns to support.
        </p>

        <h2 className="text-base font-semibold text-foreground">6. Your rights</h2>
        <p>
          Depending on jurisdiction, you may request access, correction, deletion, or portability of
          personal data. Workspace admins manage team and customer data within the product. Contact us
          for account-level requests.
        </p>

        <h2 className="text-base font-semibold text-foreground">7. International transfers</h2>
        <p>
          Data may be processed in India and where our subprocessors operate. We take steps to ensure
          appropriate safeguards.
        </p>

        <h2 className="text-base font-semibold text-foreground">8. Changes</h2>
        <p>
          We may update this policy. Continued use after changes constitutes acceptance. See also our{" "}
          <Link to="/terms" className="text-primary hover:underline">
            Terms of Service
          </Link>
          .
        </p>

        <h2 className="text-base font-semibold text-foreground">9. Contact</h2>
        <p>Privacy inquiries: support@enertechups.com</p>
      </section>
    </LegalShell>
  );
}
