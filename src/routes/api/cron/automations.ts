import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";
import {
  processDueFollowUps,
  processScheduledAutomationSteps,
} from "@/server/automation-engine";
import { tickIndiaMartAutoSync, tickIndiaMartBackfill } from "@/server/indiamart";
import { tickTradeIndiaAutoSync, tickTradeIndiaBackfill } from "@/server/tradeindia";
import { tickBrainmineAutoSync } from "@/server/brainmine";
import { tickPendingEmailBroadcasts } from "@/server/gmail";

const CRON_LOCK_KEY = "automations";

/**
 * Scheduled jobs: due follow-ups + Wait resumes + IndiaMART/TradeIndia/Brainmine backfill + auto lead sync
 * + resume Gmail campaigns stuck mid-send (delay pacing).
 * Point Render cron at:
 *   POST {VITE_APP_URL}/api/cron/automations
 * Header: Authorization: Bearer {CRON_SECRET}
 * Suggested interval: every 1–5 minutes.
 *
 * Overlapping ticks share a Postgres lease — only one holder runs the work.
 */
export const Route = createFileRoute("/api/cron/automations")({
  server: {
    handlers: {
      GET: async ({ request }) => runCron(request),
      POST: async ({ request }) => runCron(request),
    },
  },
});

async function runCron(request: Request): Promise<Response> {
  const ok = authorize(request);
  if (!ok) return new Response("Unauthorized", { status: 401 });

  const supabase = createServiceSupabase();
  const holder = crypto.randomUUID();
  const { data: acquired, error: leaseErr } = await supabase.rpc("try_acquire_cron_lease", {
    p_key: CRON_LOCK_KEY,
    p_holder: holder,
    p_ttl_seconds: 240,
  });

  if (leaseErr) {
    // Migration 030 not applied yet — run unlocked (log once per tick).
    console.warn("cron lease unavailable; running without lock:", leaseErr.message);
  } else if (!acquired) {
    return Response.json({ success: true, skipped: true, reason: "lease_held" });
  }

  try {
    const [followUps, waits, indiamart, tradeindia, imAuto, tiAuto, bmAuto, emailBc, dailyFollow] =
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
        tickBrainmineAutoSync().catch((err) => ({
          error: err instanceof Error ? err.message : "brainmine auto sync failed",
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
      leaseHolder: holder,
      followUps,
      waits,
      indiamart,
      tradeindia,
      indiamartAutoSync: imAuto,
      tradeindiaAutoSync: tiAuto,
      brainmineAutoSync: bmAuto,
      emailBroadcasts: emailBc,
      dailyFollowUp: dailyFollow,
    });
  } finally {
    if (!leaseErr && acquired) {
      try {
        await supabase.rpc("release_cron_lease", { p_key: CRON_LOCK_KEY, p_holder: holder });
      } catch (err) {
        console.warn("cron lease release failed", err);
      }
    }
  }
}

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
