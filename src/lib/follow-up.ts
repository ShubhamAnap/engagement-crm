/** Shared follow-up date + Brainmine pending-push rules (Inbox, Leads, write-back). */

export const FOLLOW_UP_DAYS = 4;

export function ymdPlusDays(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Matches Brainmine write-back: calendar date + N days at 10:00 UTC. */
export function nextFollowUpAtIso(from = new Date()): string {
  return `${ymdPlusDays(FOLLOW_UP_DAYS, from)}T10:00:00.000Z`;
}

export function formatFollowUpDateLabel(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Lead needs a new Brainmine Follow Up row (summary updated since last CRM push). */
export function isBrainmineFollowUpPending(meta: Record<string, unknown> | null | undefined): boolean {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  if (meta.brainmine_followup_pending === true) return true;
  const summaryAt = String(meta.follow_up_summary_at || "").trim();
  const writtenAt = String(meta.brainmine_followup_written_at || "").trim();
  const summary =
    typeof meta.follow_up_summary === "string" ? meta.follow_up_summary.trim() : "";
  if (!summary) return false;
  if (!writtenAt) return true;
  if (!summaryAt) return false;
  return new Date(summaryAt).getTime() > new Date(writtenAt).getTime();
}

export function markBrainmineFollowUpPending(
  meta: Record<string, unknown>,
  ranAt: string,
): Record<string, unknown> {
  meta.follow_up_summary_at = ranAt;
  meta.brainmine_followup_pending = true;
  return meta;
}

export function clearBrainmineFollowUpPending(meta: Record<string, unknown>): Record<string, unknown> {
  meta.brainmine_followup_pending = false;
  return meta;
}
