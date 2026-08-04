/**
 * Shared conversation guards: service vs catalogue, handoff, wait copy.
 * Keep customer-facing tone human — never say "bot" or "human agent".
 */

export function isServiceIntent(text: string): boolean {
  const q = String(text || "").toLowerCase();
  return /after[\s-]?sales|\bamc\b|service\s*(request|call|ticket|visit|support|engineer)|need\s*(a\s*)?service|call\s*(a\s*)?(technician|engineer)|repair|not\s*work|isn'?t\s*working|doesn'?t\s*work|won'?t\s*(start|turn\s*on)|faulty|breakdown|complaint|no\s*output|error\s*code|tripped|beeping|overheat|burning\s*smell|site\s*visit|commissioning\s*issue|kharab|band\s*ho|problem\s*(hai|with)|issue\s*with/.test(
    q,
  );
}

/**
 * Tight handoff — escalate only on clear requests.
 * Do NOT match bare "agent" (product talk). Customer never hears "bot/human".
 */
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

/**
 * Human-sounding "please wait" — no bot/agent reveal.
 * Light Hindi/Hinglish detection from the same message / recent tone.
 */
export function humanWaitReply(text: string): string {
  const q = String(text || "").toLowerCase();
  const hindi =
    /[\u0900-\u097F]/.test(text) ||
    /\b(ji|haan|nahi|please|plz|bhai|sir|madam|baat|karo|kijiye|jaldi)\b/i.test(q);
  if (hindi) {
    return "Theek hai sir, please thoda wait kijiye — main aapko jaldi reply karta hoon.";
  }
  return "Okay sir, please wait a moment — I will get back to you shortly.";
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

  // If still missing and message is short, assign to first missing slot
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

export function nextServiceTicketPrompt(ticket: ServiceTicket): string {
  const missing = serviceTicketMissing(ticket);
  if (!missing.length) {
    return "Thank you sir — I have noted the details. Please wait a moment, I will update you shortly.";
  }
  const first = missing[0];
  if (first === "model") return "Sure sir — please share the product model (e.g. inverter / UPS model).";
  if (first === "serial") return "Please share the serial number from the product label (if available).";
  if (first === "fault") return "Please describe the problem briefly (what is not working / any error).";
  return "Please share the site city / location.";
}
