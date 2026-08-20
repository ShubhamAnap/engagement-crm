import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";
import { isBusinessEmail, normalizeAuthEmail } from "@/lib/auth-email";
import { assertSignupRateLimit, inviteOnlyMode } from "@/server/signup-rate-limit";
import { provisionOrganization } from "@/server/org-provision";
import { findPendingInviteForEmail } from "@/server/org-invites";

export const Route = createFileRoute("/api/signup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await assertSignupRateLimit(request);

          const body = await request.json();
          const { orgName, fullName, email, password, phone } = body as {
            orgName: string;
            fullName: string;
            email: string;
            password: string;
            phone?: string;
          };

          if (!orgName?.trim() || !fullName?.trim() || !email?.trim() || !password) {
            return Response.json({ error: "All fields are required." }, { status: 400 });
          }
          if (password.length < 8) {
            return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
          }

          const normalizedEmail = normalizeAuthEmail(email);
          if (!isBusinessEmail(normalizedEmail)) {
            return Response.json(
              { error: "Please use your business email (not Gmail, Yahoo, etc.)." },
              { status: 400 },
            );
          }

          const supabase = createServiceSupabase();

          if (inviteOnlyMode()) {
            const invite = await findPendingInviteForEmail(normalizedEmail);
            if (!invite) {
              return Response.json(
                { error: "Signup is invite-only. Ask your admin for an invite first." },
                { status: 403 },
              );
            }
          }

          const result = await provisionOrganization(supabase, {
            orgName: orgName.trim(),
            fullName: fullName.trim(),
            email: normalizedEmail,
            password,
            phone: phone?.trim() || null,
          });

          return Response.json({ ok: true, orgId: result.orgId });
        } catch (err) {
          console.error("[signup]", err);
          const message = err instanceof Error ? err.message : "Signup failed";
          const status = /too many signup/i.test(message) ? 429 : 500;
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});
