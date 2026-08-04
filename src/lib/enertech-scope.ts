/**
 * Keep customer chat on EnerTech products & services only.
 * General knowledge / politics / unrelated topics get a fixed polite refusal.
 */

export const OFF_TOPIC_REPLY =
  "I can only help you with EnerTech products and services. Thank you.";

/** Pure noise / thanks — no bot reply. Do NOT include yes/no/sure (those answer questions). */
const ACK_ONLY_RE =
  /^(ok|okay|oke|k|kk|okey|ok\.|thanks|thank\s*you|thx|ty|bye|goodbye|tc|hmm+|hmmm+|lol+|lmao|haha+|hehe+|a+|u+|e+|n+|y+|m+|w+|z+|\.+|\?+|!+|…+)$/i;

const EMOJI_ONLY_RE =
  /^(?:\p{Extended_Pictographic}|\uFE0F|\u200D|\s)+$/u;

/** Short greetings that still get a tiny welcome (not product dumps). */
const GREETING_RE =
  /^(hi|hello|hey|hii|hlo|namaste|namaskar|good\s*(morning|afternoon|evening))[\s!.]*$/i;

export const GREETING_REPLY =
  "Hello! How can I help you with EnerTech products or services?";

const HANDOFF_RE =
  /\b(talk\s*to\s*(a\s*)?(human|person|someone|executive)|speak\s*to\s*(a\s*)?(human|person|someone|executive)|real\s*person|human\s*support|support\s*executive|call\s*me(\s*back)?|callback|please\s*call|connect\s*me\s*to\s*(a\s*)?(human|support|sales|service))\b/i;

/** Product / service / sales / commercial vocabulary. */
const IN_SCOPE_RE =
  /\b(enertech|ups|inverter|battery|batteries|bess|solar|hybrid|ongrid|on[\s-]?grid|off[\s-]?grid|catalogue|catalog|datasheet|brochure|quotation|quote|price|pricing|cost|warranty|rma|service|repair|amc|install|installation|reference|refrence|photo|picture|image|runtime|backup|kva|kw|charger|sfc|frequency|converter|petrol|cold\s*storage|hospital|poultry|farm\s*house|dealer|distributor|product|products|load|fault|complaint|technician|engineer|serial|model|pdf|specification|specs?|voltage|lithium|lead[\s-]?acid|smps|stabilizer|servo|online\s*ups|offline\s*ups|three[\s-]?phase|single[\s-]?phase|1\s*ph|3\s*ph|e[\s-]?series|reefi|commission|site\s*visit|not\s*working|problem|issue|kharab|dikhao|dikha|bhejo|chahiye|chahie|proforma|gst|invoice|po\b|purchase|buy|order|demo|enquiry|inquiry|lead|support|after[\s-]?sales|deliver|delivery|dispatch|ship|shipping|courier|track|tracking|payment|advance|pune|mumbai|delhi|bangalore|bengaluru|hyderabad|chennai|ahmedabad|kolkata|jaipur|surat|nagpur|noida|gurgaon|gurugram|location|address|city|site|office|warehouse)\b/i;

/** "ok", "thanks", noise — save silently, do not reply. */
export function isAckOnlyMessage(text: string): boolean {
  const q = String(text || "").trim();
  if (!q || q.length > 40) return false;
  if (EMOJI_ONLY_RE.test(q) && !/[a-z0-9]/i.test(q)) return true;
  return ACK_ONLY_RE.test(q);
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
  if (q.length <= 24 && /^(1|3)\s*ph\b|ongrid|bess|hybrid|e[\s-]?series/i.test(q)) return true;

  if (isAckOnlyMessage(q) || isGreetingOnlyMessage(q)) return true;
  if (HANDOFF_RE.test(q)) return true;
  if (IN_SCOPE_RE.test(q)) return true;

  // Affirmative answers after a business question (yes/no kept in scope)
  if (/^(yes|no|sure|ji|haan|han|nahi|nope|yep|yeah)[\s!.]*$/i.test(q)) return true;

  return false;
}

export function isOffTopicMessage(text: string): boolean {
  return !isEnerTechScopeMessage(text);
}
