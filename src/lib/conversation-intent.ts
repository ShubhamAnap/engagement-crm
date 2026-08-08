/**
 * Customer chat intent helpers (EN + Hinglish WhatsApp patterns).
 * Keep product-card / catalogue / photo shortcuts off educational asks.
 */

const KW_RE = /(\d+(?:\.\d+)?)\s*(k\.?\s*w|k\.?\s*va|kw|kva)\b/i;
const PRICE_RE = /\b(price|pricing|cost|rate|quote|quotation|kitna|kitne|rs\.?|₹|inr)\b/i;

/** Informational / educational — answer with Knowledge Base, do not dump packs/PDFs/photos. */
const DEFINITION_ASK_RE =
  /\b(what\s+is|what\s+are|what'?s\s+(a|an|the)?|whats\s+(a|an|the)?|explain|meaning\s+of|define|definition|how\s+does|how\s+do|how\s+it\s+works|difference\s+between|diff(?:erence)?\s+between|\bvs\.?\b|versus|compare|comparison|which\s+is\s+better|tell\s+me\s+about|teach\s+me|help\s+me\s+understand)\b/i;

const HINGLISH_DEFINITION_ASK_RE =
  /\b(kya\s+(hai|hota|hoti|hote)|matlab\s*(kya)?|samjhao|samjha\s*do|ke\s+bare\s+me[n]?|bare\s+me[n]?|batao\s+kya|bat(a|ao)\s+na\s+kya)\b/i;

/** Buy / browse / share — product cards, catalogue PDF, or photos are OK. */
const TRANSACTIONAL_PRODUCT_RE =
  /\b(price|pricing|cost|rate|quote|quotation|kitna|kitne|rs\.?|₹|inr|bhejo|dikhao|dikha\b|send|share|catalogue|catalog|brochure|datasheet|\bpdf\b|chahiye|chahie|want|need|buy|order|purchase|stock|mujhe|mere\s*ko|recommend|suggest(?:ion)?|options?|show\s+me|send\s+me|do\s+you\s+have|hai\s+kya|available|photo|picture|image|\bpic\b|gallery|reference|refrence)\b/i;

/** True when the message is mainly asking for an explanation / concept. */
export function isInformationalProductAsk(text: string): boolean {
  const q = String(text || "").trim();
  if (!q) return false;
  return DEFINITION_ASK_RE.test(q) || HINGLISH_DEFINITION_ASK_RE.test(q);
}

/** Strong commercial / share signals that override educational phrasing. */
export function hasTransactionalProductSignal(text: string): boolean {
  const q = String(text || "").trim();
  if (!q) return false;
  if (KW_RE.test(q)) return true;
  if (PRICE_RE.test(q)) return true;
  if (TRANSACTIONAL_PRODUCT_RE.test(q)) return true;
  return false;
}

/**
 * Educate-only turn: explain from KB/AI.
 * Do not auto-send product cards, catalogue PDFs, or reference photos.
 */
export function isEducateOnlyAsk(text: string): boolean {
  return isInformationalProductAsk(text) && !hasTransactionalProductSignal(text);
}
