import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";
import {
  ingestIndiaMartEnquiry,
  type IndiaMartEnquiry,
} from "@/server/indiamart";
import {
  DEFAULT_ORG_ID,
  isOrgActive,
  resolveChannelByConfig,
  runWithOrg,
} from "@/server/org-context";

/**
 * IndiaMART Push API webhook (real-time leads).
 * Point IndiaMART CRM Push "Other" webhook to:
 *   {VITE_APP_URL}/api/webhooks/indiamart
 *
 * Header: x-enertech-indiamart-secret (required; must match that org's push_secret)
 */
export const Route = createFileRoute("/api/webhooks/indiamart")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          channel: "indiamart",
          usage: "POST IndiaMART Push API lead payload, or use Channels → Sync for Pull API",
        }),
      POST: async ({ request }) => {
        try {
          const secretHeader = (request.headers.get("x-enertech-indiamart-secret") || "").trim();
          if (!secretHeader) return new Response("Forbidden", { status: 403 });

          const supabase = createServiceSupabase();
          const hit = await resolveChannelByConfig(supabase, {
            type: "indiamart",
            configKey: "push_secret",
            configValue: secretHeader,
          });
          const envSecret = (process.env.INDIAMART_PUSH_SECRET || "").trim();
          const orgId =
            hit?.orgId ||
            (envSecret && secretHeader === envSecret ? DEFAULT_ORG_ID : null);
          if (!orgId) return new Response("Forbidden", { status: 403 });
          if (!(await isOrgActive(supabase, orgId))) {
            return new Response("Workspace suspended", { status: 403 });
          }

          const payload = (await request.json()) as Record<string, unknown>;
          let enquiry: IndiaMartEnquiry | null = null;

          if (payload.UNIQUE_QUERY_ID) {
            enquiry = payload as IndiaMartEnquiry;
          } else if (payload.RESPONSE && typeof payload.RESPONSE === "object") {
            enquiry = payload.RESPONSE as IndiaMartEnquiry;
          } else if (
            payload.body &&
            typeof payload.body === "object" &&
            (payload.body as { RESPONSE?: unknown }).RESPONSE
          ) {
            enquiry = (payload.body as { RESPONSE: IndiaMartEnquiry }).RESPONSE;
          }

          if (!enquiry?.UNIQUE_QUERY_ID) {
            return Response.json({ ok: false, error: "Missing UNIQUE_QUERY_ID" }, { status: 400 });
          }

          const result = await runWithOrg(orgId, () => ingestIndiaMartEnquiry(enquiry!));
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("IndiaMART webhook error", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : "webhook error" },
            { status: 400 },
          );
        }
      },
    },
  },
});
