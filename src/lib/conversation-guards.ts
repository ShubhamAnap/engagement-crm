/**
 * Shared conversation guards: service vs catalogue, handoff, wait copy.
 * Keep customer-facing tone human — never say "bot" or "human agent".
 * Language: match session (EN / HI / MR / mixed) via session-language.ts
 */

import {
  resolveSessionLang,
  humanWaitReplyForLang,
  languageSwitchAck,
  serviceTicketPromptForLang,
  explicitLanguageRequest,
  type SessionLang,
} from "@/lib/session-language";

export type { SessionLang };
export {
  resolveSessionLang,
  explicitLanguageRequest,
  languageSwitchAck,
  humanWaitReplyForLang,
} from "@/lib/session-language";

export function isServiceIntent(text: string): boolean {
  const q = String(text || "").toLowerCase();
  return /after[\s-]?sales|\bamc\b|service\s*(request|call|ticket|visit|support|engineer)|need\s*(a\s*)?service|call\s*(a\s*)?(technician|engineer)|repair|not\s*work|isn'?t\s*working|doesn'?t\s*work|won'?t\s*(start|turn\s*on)|faulty|breakdown|complaint|no\s*output|error\s*code|tripped|beeping|overheat|burning\s*smell|site\s*visit|commissioning\s*issue|kharab|band\s*ho|problem\s*(hai|with)|issue\s*with/.test(
    q,
  );
}

/** Tight handoff — escalate only on clear requests. */
export function wantsHumanHandoff(text: string): boolean {
  const q = String(text || "").toLowerCase();
  return (
    /\b(talk\s*to\s*(a\s*)?(human|person|someone|executive)|speak\s*to\s*(a\s*)?(human|person|someone|executive)|real\s*person|human\s*support|support\s*executive|call\s*me(\s*back)?|callback|phone\s*call|please\s*call|manager\s*se\s*baat|insaan\s*se\s*baat|kisi\s*se\s*baat)\b/i.test(
      q,
    ) ||
    /\b(connect\s*me\s*to\s*(a\s*)?(human|support|sales|service)|transfer\s*(me\s*)?to\s*(a\s*)?(human|support|sales|service)|talk\s*to\s*(a\s*)?human\s*support)\b/i.test(
      q,
    )
  );
}

/** Stamp conversation metadata when escalating to the human queue. */
export function withHandoffMetadata(
  prev: Record<string, unknown> | null | undefined,
  reason: string,
): Record<string, unknown> {
  const base = { ...(prev || {}) };
  const existingAt = typeof base.escalated_at === "string" ? base.escalated_at : null;
  return {
    ...base,
    handoff: true,
    handoff_reason: reason,
    escalated_at: existingAt || new Date().toISOString(),
  };
}

export function isMarketplaceLeadChannelType(channel: string | null | undefined): boolean {
  const ch = String(channel || "").toLowerCase();
  return ch === "indiamart" || ch === "tradeindia" || ch === "brainmine";
}

/** True handoff for Human Support desk (excludes marketplace follow-up spam). */
export function isTrueHandoffConversation(c: {
  status?: string | null;
  channel?: string | null;
  assignee_id?: string | null;
  assignee_label?: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  const status = String(c.status || "");
  if (status === "escalated") return true;
  if (status !== "human") return false;
  const meta = (c.metadata || {}) as Record<string, unknown>;
  if (meta.handoff === true || meta.escalated_at || meta.handoff_reason) return true;
  if (c.assignee_id) return true;
  if (String(c.assignee_label || "") === "Human queue") return true;
  // Marketplace follow-ups created as status=human without handoff stamps
  if (isMarketplaceLeadChannelType(c.channel)) return false;
  return true;
}

/** @deprecated use resolveSessionLang / explicitLanguageRequest */
export function wantsEnglishReply(text: string): boolean {
  return explicitLanguageRequest(text) === "en";
}

/** @deprecated use resolveSessionLang */
export function prefersHindiReply(text: string): boolean {
  const lang = resolveSessionLang({ latestText: text });
  return lang === "hi" || lang === "mixed" || lang === "mr";
}

/**
 * Human-sounding wait — language from session context.
 * Pass recentCustomerTexts + storedLang for accurate matching.
 */
export function humanWaitReply(
  text: string,
  preferredLang?: SessionLang | "en" | "hi" | null,
  recentCustomerTexts?: string[],
): string {
  const lang = resolveSessionLang({
    latestText: text,
    storedLang: preferredLang,
    recentCustomerTexts,
  });
  return humanWaitReplyForLang(lang);
}

export function englishLanguageAck(): string {
  return languageSwitchAck("en");
}

export type ServiceTicket = {
  model?: string | null;
  serial?: string | null;
  fault?: string | null;
  city?: string | null;
  status: "collecting" | "ready" | "handed_off";
};

export function emptyServiceTicket(): ServiceTicket {
  return { model: null, serial: null, fault: null, city: null, status: "collecting" };
}

export function serviceTicketMissing(ticket: ServiceTicket): Array<keyof ServiceTicket> {
  const missing: Array<keyof ServiceTicket> = [];
  if (!ticket.model) missing.push("model");
  if (!ticket.serial) missing.push("serial");
  if (!ticket.fault) missing.push("fault");
  if (!ticket.city) missing.push("city");
  return missing.filter((k) => k !== "status");
}

/** Merge free-text into ticket fields (best-effort). */
export function mergeServiceTicketFromText(ticket: ServiceTicket, text: string): ServiceTicket {
  const next = { ...ticket };
  const t = text.trim();
  const serial =
    t.match(/\b(?:s\/?n|serial(?:\s*no(?:umber)?)?|sr\.?\s*no\.?)[:\s#-]*([A-Za-z0-9-]{4,})\b/i)?.[1] ||
    t.match(/\b([A-Z0-9]{8,})\b/)?.[1];
  if (serial && !next.serial) next.serial = serial;

  const city =
    t.match(/\b(?:in|at|from|location|city|site)[:\s]+([A-Za-z][A-Za-z\s]{2,30})\b/i)?.[1] ||
    t.match(/\b(Pune|Mumbai|Delhi|Bengaluru|Bangalore|Hyderabad|Chennai|Ahmedabad|Kolkata|Jaipur|Surat|Nagpur|Indore|Lucknow|Noida|Gurgaon|Gurugram)\b/i)?.[1];
  if (city && !next.city) next.city = city.trim();

  if (/not\s*work|fault|error|trip|beep|complaint|problem|issue|kharab|breakdown|no\s*output/i.test(t) && !next.fault) {
    next.fault = t.slice(0, 240);
  }

  if (
    !next.model &&
    /\b(ups|inverter|bess|hybrid|ongrid|charger|e[\s-]?series|reefi|[\w-]+kva)\b/i.test(t) &&
    t.length < 120
  ) {
    next.model = t.slice(0, 120);
  }

  const missing = serviceTicketMissing(next);
  if (missing.length && t.length >= 2 && t.length <= 80 && !/^(hi|hello|ok|thanks)/i.test(t)) {
    const slot = missing[0]!;
    if (slot === "model" && !next.model) next.model = t;
    else if (slot === "serial" && !next.serial) next.serial = t;
    else if (slot === "fault" && !next.fault) next.fault = t;
    else if (slot === "city" && !next.city) next.city = t;
  }

  const still = serviceTicketMissing(next);
  next.status = still.length === 0 ? "ready" : "collecting";
  return next;
}

export function nextServiceTicketPrompt(ticket: ServiceTicket, lang: SessionLang = "en"): string {
  const missing = serviceTicketMissing(ticket);
  if (!missing.length) return serviceTicketPromptForLang(lang, "done");
  const first = missing[0]!;
  if (first === "model" || first === "serial" || first === "fault" || first === "city") {
    return serviceTicketPromptForLang(lang, first);
  }
  return serviceTicketPromptForLang(lang, "city");
}
