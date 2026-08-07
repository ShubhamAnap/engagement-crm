/** Meta WhatsApp Cloud API — 24-hour customer care session window. */

export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type WhatsAppWindowState = {
  /** True when free-form text/media replies are allowed. */
  open: boolean;
  /** ISO timestamp when the window opened (last customer inbound). */
  startedAt: string | null;
  /** ISO timestamp when free-form replies stop being allowed. */
  expiresAt: string | null;
  /** Milliseconds remaining (0 if closed). */
  remainingMs: number;
  hoursRemaining: number;
  minutesRemaining: number;
  /** Short label for badges, e.g. "18h 22m left" or "Window closed". */
  label: string;
  /** urgency for UI: ok | warn | critical | closed */
  tone: "ok" | "warn" | "critical" | "closed" | "unknown";
};

/**
 * Compute window from last customer inbound timestamp.
 * If `startedAt` is null/empty → unknown (treat as closed for send safety on WhatsApp).
 */
export function getWhatsAppWindow(
  startedAt: string | null | undefined,
  nowMs: number = Date.now(),
): WhatsAppWindowState {
  if (!startedAt) {
    return {
      open: false,
      startedAt: null,
      expiresAt: null,
      remainingMs: 0,
      hoursRemaining: 0,
      minutesRemaining: 0,
      label: "No customer message yet",
      tone: "unknown",
    };
  }

  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) {
    return {
      open: false,
      startedAt,
      expiresAt: null,
      remainingMs: 0,
      hoursRemaining: 0,
      minutesRemaining: 0,
      label: "Window unknown",
      tone: "unknown",
    };
  }

  const expiresAtMs = start + WHATSAPP_WINDOW_MS;
  const remainingMs = Math.max(0, expiresAtMs - nowMs);
  const open = remainingMs > 0;
  const hoursRemaining = Math.floor(remainingMs / (60 * 60 * 1000));
  const minutesRemaining = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

  let label: string;
  let tone: WhatsAppWindowState["tone"];
  if (!open) {
    label = "Window closed — send template";
    tone = "closed";
  } else if (remainingMs <= 2 * 60 * 60 * 1000) {
    label = `${hoursRemaining}h ${minutesRemaining}m left`;
    tone = "critical";
  } else if (remainingMs <= 6 * 60 * 60 * 1000) {
    label = `${hoursRemaining}h ${minutesRemaining}m left`;
    tone = "warn";
  } else {
    label = `${hoursRemaining}h ${minutesRemaining}m left`;
    tone = "ok";
  }

  return {
    open,
    startedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    remainingMs,
    hoursRemaining,
    minutesRemaining,
    label,
    tone,
  };
}

/** Resolve start time from conversation column or last customer message created_at. */
export function resolveWhatsAppWindowStart(options: {
  waLastCustomerAt?: string | null;
  lastCustomerMessageAt?: string | null;
}): string | null {
  return options.waLastCustomerAt || options.lastCustomerMessageAt || null;
}

/** IndiaMART / TradeIndia lead threads — contact customer on WhatsApp by default. */
export function isMarketplaceLeadChannel(channel: string | null | undefined): boolean {
  return channel === "indiamart" || channel === "tradeindia";
}

/** Digits only; Indian mobiles normalized for WhatsApp / Leads storage.
 * - 10 digits → prefix 91
 * - 11 digits starting with 0 → drop 0, prefix 91
 * - 12 digits starting with 91 → keep
 */
export function normalizeWhatsAppDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  // Strip leading 00 international prefix
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  // Already 91XXXXXXXXXX (12) — keep; longer international numbers kept if ≥10
  if (digits.length < 10) return null;
  return digits;
}

/** Alias for Leads CRM storage — same rules as WhatsApp. */
export function normalizeLeadPhone(phone: string | null | undefined): string | null {
  return normalizeWhatsAppDigits(phone);
}

export function conversationRepliesViaWhatsApp(c: {
  channel?: string | null;
  visitor_phone?: string | null;
}): boolean {
  if (c.channel === "whatsapp") return true;
  if (isMarketplaceLeadChannel(c.channel) && normalizeWhatsAppDigits(c.visitor_phone)) return true;
  return false;
}

export function whatsappMeUrl(phone: string, text?: string): string {
  const digits = normalizeWhatsAppDigits(phone) || phone.replace(/\D/g, "");
  const base = `https://wa.me/${digits}`;
  if (text?.trim()) return `${base}?text=${encodeURIComponent(text.trim().slice(0, 1500))}`;
  return base;
}
