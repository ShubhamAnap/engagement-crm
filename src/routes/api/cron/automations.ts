import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";
import { captureException, structuredLog } from "@/lib/observability";
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

  const cronRunId = crypto.randomUUID();
  const started = Date.now();
  const supabase = createServiceSupabase();
  const holder = crypto.randomUUID();
  const { data: acquired, error: leaseErr } = await supabase.rpc("try_acquire_cron_lease", {
    p_key: CRON_LOCK_KEY,
    p_holder: holder,
    p_ttl_seconds: 240,
  });

  if (leaseErr) {
    structuredLog("warn", "cron lease unavailable; running without lock", {
      cronRunId,
      error: leaseErr.message,
    });
  } else if (!acquired) {
    structuredLog("info", "cron skipped — lease held", { cronRunId });
    return Response.json({ success: true, skipped: true, reason: "lease_held", cronRunId });
  }

  structuredLog("info", "cron started", { cronRunId, leaseHolder: holder });

  try {
    const [followUps, waits, indiamart, tradeindia, imAuto, tiAuto, bmAuto, emailBc, dailyFollow] =
      await Promise.all([
        processDueFollowUps(),
        processScheduledAutomationSteps().catch((err) => {
          void captureException(err, { cronRunId, job: "waits" });
          return { error: err instanceof Error ? err.message : "wait resume failed" };
        }),
        tickIndiaMartBackfill().catch((err) => {
          void captureException(err, { cronRunId, job: "indiamart_backfill" });
          return { error: err instanceof Error ? err.message : "indiamart tick failed" };
        }),
        tickTradeIndiaBackfill().catch((err) => {
          void captureException(err, { cronRunId, job: "tradeindia_backfill" });
          return { error: err instanceof Error ? err.message : "tradeindia tick failed" };
        }),
        tickIndiaMartAutoSync().catch((err) => {
          void captureException(err, { cronRunId, job: "indiamart_auto" });
          return { error: err instanceof Error ? err.message : "indiamart auto sync failed" };
        }),
        tickTradeIndiaAutoSync().catch((err) => {
          void captureException(err, { cronRunId, job: "tradeindia_auto" });
          return { error: err instanceof Error ? err.message : "tradeindia auto sync failed" };
        }),
        tickBrainmineAutoSync().catch((err) => {
          void captureException(err, { cronRunId, job: "brainmine_auto" });
          return { error: err instanceof Error ? err.message : "brainmine auto sync failed" };
        }),
        tickPendingEmailBroadcasts().catch((err) => {
          void captureException(err, { cronRunId, job: "email_broadcast" });
          return { error: err instanceof Error ? err.message : "email broadcast tick failed" };
        }),
        import("@/server/followup-agent")
          .then((m) => m.proposeDailyFollowUpCampaign())
          .catch((err) => {
            void captureException(err, { cronRunId, job: "daily_followup" });
            return {
              error: err instanceof Error ? err.message : "daily follow-up propose failed",
            };
          }),
      ]);

    const body = {
      success: true,
      cronRunId,
      leaseHolder: holder,
      ms: Date.now() - started,
      followUps,
      waits,
      indiamart,
      tradeindia,
      indiamartAutoSync: imAuto,
      tradeindiaAutoSync: tiAuto,
      brainmineAutoSync: bmAuto,
      emailBroadcasts: emailBc,
      dailyFollowUp: dailyFollow,
    };

    structuredLog("info", "cron finished", {
      cronRunId,
      ms: body.ms,
      followUpsProcessed: (followUps as { processed?: number })?.processed,
    });

    return Response.json(body);
  } catch (err) {
    void captureException(err, { cronRunId, job: "cron_fatal" });
    throw err;
  } finally {
    if (!leaseErr && acquired) {
      try {
        await supabase.rpc("release_cron_lease", { p_key: CRON_LOCK_KEY, p_holder: holder });
      } catch (err) {
        structuredLog("warn", "cron lease release failed", {
          cronRunId,
          error: err instanceof Error ? err.message : String(err),
        });
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
