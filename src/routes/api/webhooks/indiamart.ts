import { createFileRoute } from "@tanstack/react-router";
import {
  ingestIndiaMartEnquiry,
  loadIndiaMartConfig,
  type IndiaMartEnquiry,
} from "@/server/indiamart";

/**
 * IndiaMART Push API webhook (real-time leads).
 * Point IndiaMART CRM Push "Other" webhook to:
 *   {VITE_APP_URL}/api/webhooks/indiamart
 *
 * Header: x-enertech-indiamart-secret (required in production; must match push_secret)
 *
 * Body may be the enquiry fields directly, or wrapped as { RESPONSE: {...} } / { body: { RESPONSE } }.
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
          const cfg = await loadIndiaMartConfig();
          const secretHeader = request.headers.get("x-enertech-indiamart-secret");
          if (cfg.push_secret) {
            if (!secretHeader || secretHeader !== cfg.push_secret) {
              return new Response("Forbidden", { status: 403 });
            }
          } else {
            console.warn("IndiaMART webhook: push_secret unset — accepting");
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

          const result = await ingestIndiaMartEnquiry(enquiry);
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
