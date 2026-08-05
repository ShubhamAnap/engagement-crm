import { createFileRoute } from "@tanstack/react-router";
import {
  processDueFollowUps,
  processScheduledAutomationSteps,
} from "@/server/automation-engine";
import { tickIndiaMartAutoSync, tickIndiaMartBackfill } from "@/server/indiamart";
import { tickTradeIndiaAutoSync, tickTradeIndiaBackfill } from "@/server/tradeindia";
import { tickPendingEmailBroadcasts } from "@/server/gmail";

/**
 * Scheduled jobs: due follow-ups + Wait resumes + IndiaMART/TradeIndia backfill + auto lead sync
 * + resume Gmail campaigns stuck mid-send (delay pacing).
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
        const [followUps, waits, indiamart, tradeindia, imAuto, tiAuto, emailBc, dailyFollow] =
          await Promise.all([
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
            tickIndiaMartAutoSync().catch((err) => ({
              error: err instanceof Error ? err.message : "indiamart auto sync failed",
            })),
            tickTradeIndiaAutoSync().catch((err) => ({
              error: err instanceof Error ? err.message : "tradeindia auto sync failed",
            })),
            tickPendingEmailBroadcasts().catch((err) => ({
              error: err instanceof Error ? err.message : "email broadcast tick failed",
            })),
            import("@/server/followup-agent")
              .then((m) => m.proposeDailyFollowUpCampaign())
              .catch((err) => ({
                error: err instanceof Error ? err.message : "daily follow-up propose failed",
              })),
          ]);
        return Response.json({
          success: true,
          followUps,
          waits,
          indiamart,
          tradeindia,
          indiamartAutoSync: imAuto,
          tradeindiaAutoSync: tiAuto,
          emailBroadcasts: emailBc,
          dailyFollowUp: dailyFollow,
        });
      },
      POST: async ({ request }) => {
        const ok = authorize(request);
        if (!ok) return new Response("Unauthorized", { status: 401 });
        const [followUps, waits, indiamart, tradeindia, imAuto, tiAuto, emailBc, dailyFollow] =
          await Promise.all([
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
            tickIndiaMartAutoSync().catch((err) => ({
              error: err instanceof Error ? err.message : "indiamart auto sync failed",
            })),
            tickTradeIndiaAutoSync().catch((err) => ({
              error: err instanceof Error ? err.message : "tradeindia auto sync failed",
            })),
            tickPendingEmailBroadcasts().catch((err) => ({
              error: err instanceof Error ? err.message : "email broadcast tick failed",
            })),
            import("@/server/followup-agent")
              .then((m) => m.proposeDailyFollowUpCampaign())
              .catch((err) => ({
                error: err instanceof Error ? err.message : "daily follow-up propose failed",
              })),
          ]);
        return Response.json({
          success: true,
          followUps,
          waits,
          indiamart,
          tradeindia,
          indiamartAutoSync: imAuto,
          tradeindiaAutoSync: tiAuto,
          emailBroadcasts: emailBc,
          dailyFollowUp: dailyFollow,
        });
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
