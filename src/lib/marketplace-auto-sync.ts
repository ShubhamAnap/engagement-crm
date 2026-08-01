/** Shared IndiaMART / TradeIndia recurring lead auto-sync (IST schedules). */

export type AutoSyncSchedule = "hourly" | "every_6h" | "daily_at";

export type MarketplaceAutoSyncFields = {
  auto_sync_enabled?: boolean;
  auto_sync_schedule?: AutoSyncSchedule;
  /** HH:MM in Asia/Kolkata when schedule is daily_at */
  auto_sync_daily_time?: string;
  last_auto_sync_at?: string;
};

export const AUTO_SYNC_SCHEDULE_OPTIONS: { value: AutoSyncSchedule; label: string }[] = [
  { value: "hourly", label: "Every hour" },
  { value: "every_6h", label: "Every 6 hours" },
  { value: "daily_at", label: "Once a day" },
];

/** Common IST times for daily preset */
export const AUTO_SYNC_DAILY_TIME_OPTIONS: { value: string; label: string }[] = [
  { value: "06:00", label: "6:00 AM IST" },
  { value: "09:00", label: "9:00 AM IST" },
  { value: "12:00", label: "12:00 PM IST" },
  { value: "15:00", label: "3:00 PM IST" },
  { value: "18:00", label: "6:00 PM IST" },
  { value: "21:00", label: "9:00 PM IST" },
];

const IST = "Asia/Kolkata";

function istParts(d: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === 24 ? 0 : get("hour"),
    minute: get("minute"),
  };
}

function istDayKey(d: Date): string {
  const p = istParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function normalizeDailyTime(raw?: string | null): string {
  const v = (raw || "18:00").trim();
  if (!/^\d{1,2}:\d{2}$/.test(v)) return "18:00";
  const [h, m] = v.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return "18:00";
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function describeAutoSync(cfg: MarketplaceAutoSyncFields): string {
  if (!cfg.auto_sync_enabled) return "Auto sync off — use Sync leads now";
  const schedule = cfg.auto_sync_schedule || "every_6h";
  if (schedule === "hourly") return "Auto sync every hour (IST cron)";
  if (schedule === "every_6h") return "Auto sync every 6 hours";
  const time = normalizeDailyTime(cfg.auto_sync_daily_time);
  const opt = AUTO_SYNC_DAILY_TIME_OPTIONS.find((o) => o.value === time);
  return `Auto sync daily at ${opt?.label || `${time} IST`}`;
}

/**
 * Whether a scheduled pull should run now.
 * Cron is expected ~every 5 minutes; daily uses IST calendar day + target time.
 */
export function isAutoSyncDue(cfg: MarketplaceAutoSyncFields, now = new Date()): boolean {
  if (!cfg.auto_sync_enabled) return false;

  const schedule = cfg.auto_sync_schedule || "every_6h";
  const lastMs = cfg.last_auto_sync_at ? new Date(cfg.last_auto_sync_at).getTime() : 0;
  const elapsed = now.getTime() - (Number.isFinite(lastMs) ? lastMs : 0);
  const slackMs = 45_000;

  if (schedule === "hourly") {
    return elapsed >= 60 * 60 * 1000 - slackMs;
  }
  if (schedule === "every_6h") {
    return elapsed >= 6 * 60 * 60 * 1000 - slackMs;
  }

  const time = normalizeDailyTime(cfg.auto_sync_daily_time);
  const [hh, mm] = time.split(":").map(Number);
  const p = istParts(now);
  const nowMinutes = p.hour * 60 + p.minute;
  const targetMinutes = hh * 60 + mm;
  if (nowMinutes < targetMinutes) return false;

  if (lastMs > 0 && istDayKey(new Date(lastMs)) === istDayKey(now)) {
    return false;
  }
  return true;
}
