/**
 * Keep customer chat on EnerTech products & services only.
 * General knowledge / politics / unrelated topics get a fixed polite refusal.
 */

export const OFF_TOPIC_REPLY =
  "I can only help you with EnerTech products and services. Thank you.";

/** Greetings, thanks, handoff, and catalogue number picks stay allowed. */
const ALLOW_ALWAYS_RE =
  /^(hi|hello|hey|hii|hlo|namaste|namaskar|good\s*(morning|afternoon|evening)|thanks|thank\s*you|ok|okay|oke|bye|goodbye|ji|haan|han|yes|no|sure)\b/i;

const HANDOFF_RE = /\b(human|agent|executive|speak\s*to\s*(someone|person)|real\s*person|call\s*me|callback)\b/i;

/** Product / service / sales / support vocabulary (EN + common IN terms). */
const IN_SCOPE_RE =
  /\b(enertech|ups|inverter|battery|batteries|bess|solar|hybrid|ongrid|on[\s-]?grid|off[\s-]?grid|catalogue|catalog|datasheet|brochure|quotation|quote|price|pricing|cost|warranty|rma|service|repair|amc|install|installation|reference|refrence|photo|picture|image|runtime|backup|kva|kw|charger|sfc|frequency|converter|petrol|cold\s*storage|hospital|poultry|farm\s*house|dealer|distributor|product|products|load|fault|complaint|technician|engineer|serial|model|pdf|specification|specs?|voltage|lithium|lead[\s-]?acid|smps|stabilizer|servo|online\s*ups|offline\s*ups|three[\s-]?phase|single[\s-]?phase|1\s*ph|3\s*ph|e[\s-]?series|reefi|commission|site\s*visit|not\s*working|problem|issue|kharab|dikhao|dikha|bhejo|chahiye|chahie|quotation|proforma|gst|invoice|po\b|purchase|buy|order|demo|enquiry|inquiry|lead|support|after[\s-]?sales)\b/i;

/**
 * True when the message is in EnerTech customer-support scope (or a harmless greeting / pick).
 */
export function isEnerTechScopeMessage(text: string): boolean {
  const q = String(text || "").trim();
  if (!q) return true;

  // Catalogue / clarify picks: "2", "3ph"
  if (/^\d{1,2}$/.test(q)) return true;
  if (q.length <= 24 && /^(1|3)\s*ph\b|ongrid|bess|hybrid|e[\s-]?series/i.test(q)) return true;

  if (q.length <= 48 && ALLOW_ALWAYS_RE.test(q)) return true;
  if (HANDOFF_RE.test(q)) return true;
  if (IN_SCOPE_RE.test(q)) return true;

  return false;
}

export function isOffTopicMessage(text: string): boolean {
  return !isEnerTechScopeMessage(text);
}
