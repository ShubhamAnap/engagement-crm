/** Inbox thread snooze (desk reminder). Not lead/Brainmine follow-up. */

export const INBOX_SNOOZE_UNTIL_KEY = "inbox_snooze_until";

export function conversationMeta(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
}

export function parseInboxSnoozeUntil(meta: Record<string, unknown> | null | undefined): string | null {
  const v = meta?.[INBOX_SNOOZE_UNTIL_KEY];
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? v : null;
}

export function stripInboxSnooze(meta: Record<string, unknown>): Record<string, unknown> {
  if (!(INBOX_SNOOZE_UNTIL_KEY in meta)) return meta;
  const next = { ...meta };
  delete next[INBOX_SNOOZE_UNTIL_KEY];
  return next;
}

/** Merge into a conversations.update payload when a snooze should be cleared. */
export function withInboxSnoozeCleared<T extends Record<string, unknown>>(
  update: T,
  existingMeta: unknown,
): T {
  const meta = conversationMeta(existingMeta);
  if (!parseInboxSnoozeUntil(meta)) return update;
  return { ...update, metadata: stripInboxSnooze(meta) };
}

export type InboxSnoozeState = {
  until: string;
  due: boolean;
  label: string;
};

export function inboxSnoozeState(
  meta: Record<string, unknown> | null | undefined,
  nowMs = Date.now(),
): InboxSnoozeState | null {
  const until = parseInboxSnoozeUntil(meta);
  if (!until) return null;
  const t = Date.parse(until);
  const due = t <= nowMs;
  if (due) return { until, due: true, label: "Follow up now" };
  const remain = t - nowMs;
  const hours = remain / 3_600_000;
  let label = "Snoozed";
  if (hours < 1.5) label = `Snooze ${Math.max(1, Math.round(remain / 60_000))}m`;
  else if (hours < 36) label = `Snooze ${Math.round(hours)}h`;
  else label = `Snooze ${Math.round(hours / 24)}d`;
  return { until, due: false, label };
}

export function formatLastSeen(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = Math.max(0, nowMs - t);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}
