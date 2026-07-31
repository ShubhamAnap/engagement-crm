import { createFileRoute } from "@tanstack/react-router";
import {
  processDueFollowUps,
  processScheduledAutomationSteps,
} from "@/server/automation-engine";
import { tickIndiaMartBackfill } from "@/server/indiamart";
import { tickTradeIndiaBackfill } from "@/server/tradeindia";

/**
 * Scheduled jobs: due follow-ups + Wait resumes + IndiaMART/TradeIndia backfill ticks.
 * Point Render cron at:
 *   POST {VITE_APP_URL}/api/cron/automations
 * Header: Authorization: Bearer {CRON_SECRET}
 * Suggested interval: every 1–5 minutes.
 */
export const Route = createFileRoute("/api/cron/automations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ok = authorize(request);
        if (!ok) return new Response("Unauthorized", { status: 401 });
        const [followUps, waits, indiamart, tradeindia] = await Promise.all([
          processDueFollowUps(),
          processScheduledAutomationSteps().catch((err) => ({
            error: err instanceof Error ? err.message : "wait resume failed",
          })),
          tickIndiaMartBackfill().catch((err) => ({
            error: err instanceof Error ? err.message : "indiamart tick failed",
          })),
          tickTradeIndiaBackfill().catch((err) => ({
            error: err instanceof Error ? err.message : "tradeindia tick failed",
          })),
        ]);
        return Response.json({ success: true, followUps, waits, indiamart, tradeindia });
      },
      POST: async ({ request }) => {
        const ok = authorize(request);
        if (!ok) return new Response("Unauthorized", { status: 401 });
        const [followUps, waits, indiamart, tradeindia] = await Promise.all([
          processDueFollowUps(),
          processScheduledAutomationSteps().catch((err) => ({
            error: err instanceof Error ? err.message : "wait resume failed",
          })),
          tickIndiaMartBackfill().catch((err) => ({
            error: err instanceof Error ? err.message : "indiamart tick failed",
          })),
          tickTradeIndiaBackfill().catch((err) => ({
            error: err instanceof Error ? err.message : "tradeindia tick failed",
          })),
        ]);
        return Response.json({ success: true, followUps, waits, indiamart, tradeindia });
      },
    },
  },
});

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Dev-friendly: allow when secret unset (local only). Set CRON_SECRET in production.
    return process.env.NODE_ENV !== "production";
  }
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const header = request.headers.get("x-cron-secret") || "";
  return bearer === secret || header === secret;
}
