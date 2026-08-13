/**
 * Keep customer chat on EnerTech products & services.
 * Prefer continuing the conversation — only hard-block clear off-topic (politics, homework, etc.).
 */

export const OFF_TOPIC_REPLY =
  "I can only help you with EnerTech products and services. Thank you.";

/** Pure noise / thanks — no bot reply. Do NOT include yes/no/sure (those answer questions). */
const ACK_ONLY_RE =
  /^(ok|okay|oke|k|kk|okey|ok\.|thanks|thank\s*you|thx|ty|bye|goodbye|tc|hmm+|hmmm+|lol+|lmao|haha+|hehe+|a+|u+|e+|n+|y+|m+|w+|z+|\.+|\?+|!+|…+)$/i;

/** “Okay sir” / “Ok sir” — not silent (used after PDFs for a short commercial ack). */
export function isOkaySirAckMessage(text: string): boolean {
  const q = String(text || "").trim();
  if (!q || q.length > 40) return false;
  return /^(ok|okay|oke)\s+sir[\s!.🙏]*$/i.test(q);
}

const EMOJI_ONLY_RE =
  /^(?:\p{Extended_Pictographic}|\uFE0F|\u200D|\s)+$/u;

/** Short greetings that still get a tiny welcome (not product dumps). */
const GREETING_RE =
  /^(hi+|hlo|hello|hey+|ho|namaste|namaskar|good\s*(morning|afternoon|evening))[\s!.]*$/i;

export const GREETING_REPLY =
  "Hello! How can I help you with EnerTech products or services?";

const HANDOFF_RE =
  /\b(talk\s*to\s*(a\s*)?(human|person|someone|executive)|speak\s*to\s*(a\s*)?(human|person|someone|executive)|real\s*person|human\s*support|support\s*executive|call\s*me(\s*back)?|callback|please\s*call|connect\s*me\s*to\s*(a\s*)?(human|support|sales|service))\b/i;

/**
 * Product / service / sales vocabulary.
 * Use plurals (inverters?, batteries?) so "I need inverters" stays in scope.
 */
const IN_SCOPE_RE =
  /\b(enertech|ups|inverters?|batter(?:y|ies)|bess|solar|hybrids?|ongrid|on[\s-]?grid|off[\s-]?grid|catalogues?|catalogs?|datasheets?|brochures?|quotations?|quotes?|prices?|pricing|cost|costs|warranty|rma|service|repair|amc|install|installation|references?|refrences?|photos?|pictures?|images?|runtime|backup|kva|kw|chargers?|sfc|frequency|converters?|petrol|cold\s*storage|hospital|poultry|farm\s*house|dealers?|distributors?|products?|load|fault|complaint|technician|engineer|serial|model|pdf|specifications?|specs?|voltage|lithium|lead[\s-]?acid|smps|stabilizers?|servo|online\s*ups|offline\s*ups|three[\s-]?phase|single[\s-]?phase|1\s*ph|3\s*ph|e[\s-]?series|reefi|commission|site\s*visit|not\s*working|problem|issue|kharab|dikhao|dikha|bhejo|chahiye|chahie|proforma|gst|invoice|po\b|purchase|buy|order|demo|enquir(?:y|ies)|inquir(?:y|ies)|lead|support|after[\s-]?sales|deliver(?:y)?|dispatch|ship(?:ping)?|courier|track(?:ing)?|payment|advance|residential|commercial|resident|home|house|office|factory|industrial|application|pune|mumbai|delhi|bangalore|bengaluru|hyderabad|chennai|ahmedabad|kolkata|jaipur|surat|nagpur|noida|gurgaon|gurugram|location|address|city|site|warehouse)\b/i;

/** Clear off-topic (only these get the hard refusal when message is long / unrelated). */
const HARD_OFF_TOPIC_RE =
  /\b(politics|election|modi|trump|cricket\s*score|bollywood|homework|essay|poem|recipe|weather\s*forecast|stock\s*market|crypto|bitcoin|chatgpt|write\s*(me\s*)?(a\s*)?code|python\s*script|joke|meme)\b/i;

/** "ok", "thanks", noise — save silently, do not reply. */
export function isAckOnlyMessage(text: string): boolean {
  const q = String(text || "").trim();
  if (!q || q.length > 40) return false;
  if (EMOJI_ONLY_RE.test(q) && !/[a-z0-9]/i.test(q)) return true;
  return ACK_ONLY_RE.test(q);
}

/**
 * Soft thanks / "thank you for update" (incl. WhatsApp button titles) — silent, no bot reply.
 * Slightly longer than isAckOnlyMessage to cover common button labels.
 */
export function isSoftCustomerAckMessage(text: string): boolean {
  const q = String(text || "").trim();
  if (!q || q.length > 100) return false;
  if (isAckOnlyMessage(q)) return true;
  if (
    /^(thanks|thank\s*you|thx|ty)(\s+for\s+(the\s+)?(update|updates|info|information|confirmation|confirming|reply|response|sharing|your\s+update))?[\s!.🙏]*$/i.test(
      q,
    )
  ) {
    return true;
  }
  if (/^(got\s*it|noted|received|ok\s+noted|okay\s+noted|update\s+received|thanks\s+for\s+updating)[\s!.🙏]*$/i.test(q)) {
    return true;
  }
  return false;
}

export function isGreetingOnlyMessage(text: string): boolean {
  const q = String(text || "").trim();
  if (!q || q.length > 48) return false;
  return GREETING_RE.test(q);
}

/**
 * True when the message is in EnerTech customer-support / commercial scope.
 */
export function isEnerTechScopeMessage(text: string): boolean {
  const q = String(text || "").trim();
  if (!q) return true;

  if (/^\d{1,2}$/.test(q)) return true;
  // "3kw", "10 kW", "5kva"
  if (/^\d+(\.\d+)?\s*(kw|kva|w|va)?$/i.test(q)) return true;
  if (q.length <= 24 && /^(1|3)\s*ph\b|ongrid|bess|hybrid|e[\s-]?series/i.test(q)) return true;

  if (isAckOnlyMessage(q) || isGreetingOnlyMessage(q)) return true;
  if (HANDOFF_RE.test(q)) return true;
  if (IN_SCOPE_RE.test(q)) return true;

  // Affirmative / short answers after a business question
  if (/^(yes|no|sure|ji|haan|han|nahi|nope|yep|yeah|ok|okay)[\s!.]*$/i.test(q)) return true;

  return false;
}

export type OffTopicOptions = {
  /** True when this chat already has prior customer/AI turns — keep short follow-ups alive */
  conversationActive?: boolean;
};

/**
 * Hard off-topic only. Short follow-ups in an active chat ("Pune", "Resident", "3kw")
 * must NEVER break the conversation.
 */
export function isOffTopicMessage(text: string, options?: OffTopicOptions): boolean {
  const q = String(text || "").trim();
  if (!q) return false;

  if (isEnerTechScopeMessage(q)) return false;

  // Active sales/support thread: keep going unless clearly unrelated long ask
  if (options?.conversationActive) {
    if (q.length <= 64) return false;
    return HARD_OFF_TOPIC_RE.test(q);
  }

  // Cold start: only refuse clear hard off-topic; unknown short lines stay open
  if (q.length <= 48) return false;
  if (HARD_OFF_TOPIC_RE.test(q)) return true;

  // Long messages with no EnerTech signal → soft refuse
  return q.length > 120 && !IN_SCOPE_RE.test(q);
}
