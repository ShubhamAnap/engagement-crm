import { createFileRoute } from "@tanstack/react-router";
import { handleMetaInboundPayload, loadMetaConfig } from "@/server/meta-messenger";

/**
 * Meta Instagram Messaging webhook.
 * Callback URL: {VITE_APP_URL}/api/webhooks/instagram
 * Connect IG professional account to a Facebook Page; subscribe to Instagram messages.
 */
export const Route = createFileRoute("/api/webhooks/instagram")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const cfg = await loadMetaConfig("instagram");

        if (mode === "subscribe" && token && cfg.verify_token && token === cfg.verify_token) {
          return new Response(challenge || "", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }
        return new Response("Forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        try {
          const payload = await request.json();
          await handleMetaInboundPayload("instagram", payload);
          return Response.json({ ok: true });
        } catch (err) {
          console.error("Instagram webhook error", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : "webhook error" },
            { status: 200 },
          );
        }
      },
    },
  },
});
