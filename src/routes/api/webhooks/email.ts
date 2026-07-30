import { createFileRoute } from "@tanstack/react-router";
import { handleInboundEmail, loadEmailConfig } from "@/server/email-core";

/**
 * Inbound email webhook.
 * Point SendGrid Inbound Parse / Cloudflare Email Routing / a forwarder to:
 *   {VITE_APP_URL}/api/webhooks/email
 *
 * JSON body: { from, to?, subject?, text?, html?, messageId? }
 * Optional header: x-enertech-email-secret (must match configured inbound_secret)
 *
 * Also accepts SendGrid-style form fields: from, to, subject, text, html
 */
export const Route = createFileRoute("/api/webhooks/email")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          channel: "email",
          usage: "POST JSON { from, subject, text } or SendGrid inbound form fields",
        }),
      POST: async ({ request }) => {
        try {
          const cfg = await loadEmailConfig();
          const secretHeader = request.headers.get("x-enertech-email-secret");
          if (cfg.inbound_secret) {
            if (!secretHeader || secretHeader !== cfg.inbound_secret) {
              return new Response("Forbidden", { status: 403 });
            }
          }

          const contentType = request.headers.get("content-type") || "";
          let payload: {
            from?: string;
            to?: string;
            subject?: string;
            text?: string;
            html?: string;
            messageId?: string;
          } = {};

          if (contentType.includes("application/json")) {
            payload = (await request.json()) as typeof payload;
          } else if (
            contentType.includes("application/x-www-form-urlencoded") ||
            contentType.includes("multipart/form-data")
          ) {
            const form = await request.formData();
            payload = {
              from: String(form.get("from") || ""),
              to: String(form.get("to") || ""),
              subject: String(form.get("subject") || ""),
              text: String(form.get("text") || form.get("plain") || ""),
              html: String(form.get("html") || ""),
              messageId: String(form.get("headers") || form.get("message-id") || "") || undefined,
            };
          } else {
            // Try JSON anyway
            payload = (await request.json().catch(() => ({}))) as typeof payload;
          }

          const result = await handleInboundEmail({
            from: payload.from || "",
            to: payload.to,
            subject: payload.subject,
            text: payload.text,
            html: payload.html,
            messageId: payload.messageId,
          });

          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("Email webhook error", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : "webhook error" },
            { status: 400 },
          );
        }
      },
    },
  },
});
