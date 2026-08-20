import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";
import { readAndVerifyMetaWebhookBody } from "@/server/meta-webhook-verify";
import { handleMetaInboundPayload } from "@/server/meta-messenger";
import { verifyTokenMatchesAnyOrg } from "@/server/org-context";

/**
 * Meta Facebook Messenger webhook.
 * Callback URL: {VITE_APP_URL}/api/webhooks/facebook
 * Subscribe the Page to `messages` (and messaging_postbacks if needed).
 * Set META_APP_SECRET for X-Hub-Signature-256 verification on POST.
 */
export const Route = createFileRoute("/api/webhooks/facebook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const cfgOk = await verifyTokenMatchesAnyOrg(
          createServiceSupabase(),
          "facebook",
          token || "",
          process.env.FACEBOOK_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN,
        );
        if (mode === "subscribe" && token && cfgOk) {
          return new Response(challenge || "", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }
        return new Response("Forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        try {
          const verified = await readAndVerifyMetaWebhookBody(request);
          if (!verified.ok) return verified.response;

          await handleMetaInboundPayload("facebook", verified.payload);
          return Response.json({ ok: true });
        } catch (err) {
          console.error("Facebook webhook error", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : "webhook error" },
            { status: 200 },
          );
        }
      },
    },
  },
});
