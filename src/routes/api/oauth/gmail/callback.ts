import { createFileRoute } from "@tanstack/react-router";
import { completeGmailOAuth } from "@/server/gmail";

/**
 * Google OAuth redirect URI for Gmail (n8n-style credential).
 * Register in Google Cloud Console:
 *   {VITE_APP_URL}/api/oauth/gmail/callback
 */
export const Route = createFileRoute("/api/oauth/gmail/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") || "";
        const err = url.searchParams.get("error");
        const base = String(process.env.VITE_APP_URL || url.origin).replace(/\/$/, "");

        if (err) {
          return Response.redirect(
            `${base}/channels?gmail=error&message=${encodeURIComponent(err)}`,
            302,
          );
        }
        if (!code) {
          return Response.redirect(
            `${base}/channels?gmail=error&message=${encodeURIComponent("Missing authorization code")}`,
            302,
          );
        }

        try {
          const conn = await completeGmailOAuth(code, state);
          return Response.redirect(
            `${base}/channels?gmail=connected&email=${encodeURIComponent(conn.email)}`,
            302,
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Gmail connect failed";
          console.error("Gmail OAuth callback", e);
          return Response.redirect(
            `${base}/channels?gmail=error&message=${encodeURIComponent(message)}`,
            302,
          );
        }
      },
    },
  },
});
