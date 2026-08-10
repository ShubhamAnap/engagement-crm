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

const CONFIRM_PREFIX_RE =
  /^(yes|yesh|yeah|yep|yup|ok|okay|oke|sure|ji|haan|han|ha|theek|thik|correct|right|done|noted|confirm|confirmed|sahi|bilkul)([\s.,!]|$)/i;

const REQUIREMENT_CONTEXT_RE =
  /requirement\s*submitted|requirement\s*received|thank\s*you\s*for\s*your\s*requirement|servo|stabilizer|stabiliser|ups|inverter|battery|hybrid|bess|enquiry|inquiry|lead|\[template:/i;

const PRODUCT_BROWSE_RE =
  /\b(inverters?|ups|hybrids?|batter(?:y|ies)|bess|solar|ongrid|offgrid|stabilizers?|servo)\b/i;

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

export function extractPowerHint(text: string): string | null {
  const m = String(text || "").match(KW_RE);
  if (!m) return null;
  const n = m[1];
  const unit = /k\.?\s*va|kva/i.test(m[2] || "") ? "kVA" : "kW";
  return `${n}${unit}`;
}

/**
 * Short confirm after a requirement / template message:
 * "Yes. 30kVA" → acknowledge prior requirement, do NOT open product catalogue.
 */
export function isRequirementConfirmAck(text: string): boolean {
  const q = String(text || "").trim();
  if (!q || q.length > 80) return false;
  if (!CONFIRM_PREFIX_RE.test(q)) return false;
  if (
    /\b(price|pricing|cost|rate|quote|catalogue|catalog|brochure|pdf|bhejo|dikhao|send|share|chahiye|buy|order)\b/i.test(
      q,
    )
  ) {
    return false;
  }
  const rest = q.replace(CONFIRM_PREFIX_RE, "").trim();
  if (!rest) return true;
  if (KW_RE.test(rest) && rest.length <= 40) return true;
  if (/^[\d.\s]+(kw|kva)?$/i.test(rest)) return true;
  return rest.length <= 24 && !PRODUCT_BROWSE_RE.test(rest);
}

/** Pull requirement wording from recent thread + optional lead field. */
export function resolveActiveRequirement(options: {
  history: Array<{ sender: string; body: string }>;
  leadRequirement?: string | null;
}): string | null {
  const leadReq = String(options.leadRequirement || "").trim();
  if (leadReq) return leadReq.slice(0, 160);

  const recent = options.history.slice(-10).reverse();
  for (const m of recent) {
    if (m.sender !== "ai" && m.sender !== "agent" && m.sender !== "system") continue;
    const body = String(m.body || "");
    if (!REQUIREMENT_CONTEXT_RE.test(body) && !/\[Template:/i.test(body)) continue;
    const forMatch = body.match(
      /\b(?:for|regarding|re:|requirement[:\s]+)\s*([^\n.]{8,120})/i,
    );
    if (forMatch?.[1]) {
      return forMatch[1].replace(/\[Template:[^\]]+\]/gi, "").trim().slice(0, 160);
    }
    const cleaned = body
      .replace(/\[Template:[^\]]+\]\s*/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length >= 8) return cleaned.slice(0, 160);
  }
  return null;
}

export function hasRecentRequirementContext(
  history: Array<{ sender: string; body: string }>,
  leadRequirement?: string | null,
): boolean {
  if (String(leadRequirement || "").trim()) return true;
  return history.slice(-12).some((m) => {
    if (m.sender === "customer") return false;
    return REQUIREMENT_CONTEXT_RE.test(m.body || "") || /\[Template:/i.test(m.body || "");
  });
}

/** Short bilingual confirm — keep product dump off. */
export function requirementConfirmReply(options: {
  lang?: string | null;
  requirement: string | null;
  powerHint?: string | null;
}): string {
  const lang = (options.lang || "en").toLowerCase();
  const req = (options.requirement || "your requirement").replace(/\s+/g, " ").trim().slice(0, 100);
  const power = options.powerHint ? ` ${options.powerHint}` : "";
  if (lang === "hi" || lang === "mixed") {
    return `Ji sir,${power} ${req} — note kar liya. Aur kuch chahiye to bataiye.`
      .replace(/\s+/g, " ")
      .trim();
  }
  if (lang === "mr") {
    return `Ho sir,${power} ${req} — note kele. Ani kahi pahije asel tar sanga.`
      .replace(/\s+/g, " ")
      .trim();
  }
  return `Yes sir,${power} ${req} — noted. Please tell me if you need anything else.`
    .replace(/\s+/g, " ")
    .trim();
}
