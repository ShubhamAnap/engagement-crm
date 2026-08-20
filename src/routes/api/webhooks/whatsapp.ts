import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";
import { verifyTokenMatchesAnyOrg } from "@/server/org-context";
import { readAndVerifyMetaWebhookBody } from "@/server/meta-webhook-verify";
import { handleWhatsAppInboundPayload } from "@/server/whatsapp";

/**
 * Meta WhatsApp Cloud API webhook.
 * Configure Callback URL in Meta Developer Console to:
 *   {VITE_APP_URL}/api/webhooks/whatsapp
 * Use the same Verify Token saved in Channels → WhatsApp configure (or WHATSAPP_VERIFY_TOKEN).
 * Set META_APP_SECRET for X-Hub-Signature-256 verification on POST.
 */
export const Route = createFileRoute("/api/webhooks/whatsapp")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const supabase = createServiceSupabase();
        const ok =
          Boolean(mode === "subscribe" && token) &&
          (await verifyTokenMatchesAnyOrg(
            supabase,
            "whatsapp",
            token || "",
            process.env.WHATSAPP_VERIFY_TOKEN,
          ));

        if (ok) {
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

          await handleWhatsAppInboundPayload(verified.payload);
          return Response.json({ ok: true });
        } catch (err) {
          console.error("WhatsApp webhook error", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : "webhook error" },
            { status: 200 },
          );
        }
      },
    },
  },
});
