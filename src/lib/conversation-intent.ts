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

/** Outbound that already promised human follow-up — don't re-welcome on "hi". */
const REPRESENTATIVE_CONTACT_RE =
  /\b(representative|will contact|contact you shortly|our team will|sales (?:person|executive|team)|call(?:\s*you)?(?:\s*back)?|callback|krishna|engineer will|executive will)\b/i;

const PRODUCT_BROWSE_RE =
  /\b(inverters?|ups|hybrids?|batter(?:y|ies)|bess|solar|ongrid|offgrid|stabilizers?|servo)\b/i;

/** Meta Cloud API sample / demo templates — never send to real customers. */
export function isBlockedWhatsAppGreetingTemplate(name: string): boolean {
  const n = String(name || "")
    .trim()
    .toLowerCase();
  if (!n) return true;
  if (n === "hello_world" || n.startsWith("hello_world")) return true;
  if (/^(sample|test|demo)([_-]|$)/i.test(n)) return true;
  if (/_test$|_sample$|_demo$/i.test(n)) return true;
  return false;
}

/** True welcome-style names we may use when env is unset (still never hello_world). */
export function isAllowedWhatsAppGreetingTemplateName(name: string): boolean {
  if (isBlockedWhatsAppGreetingTemplate(name)) return false;
  return /^(welcome|greet|enquiry_ack|inquiry_ack|thank_you|thanks)/i.test(String(name || "").trim());
}

/**
 * Cold start = no prior AI/agent outbound and at most this one customer line.
 * History may already include the just-saved customer message.
 */
export function isColdConversationStart(
  history: Array<{ sender: string; body?: string }>,
): boolean {
  let outbound = 0;
  let customers = 0;
  for (const m of history) {
    if (m.sender === "customer") customers += 1;
    else if (m.sender === "ai" || m.sender === "agent" || m.sender === "system") outbound += 1;
  }
  return outbound === 0 && customers <= 1;
}

/** Thread already in sales/support handling — soft "hi/ok" must not reset to welcome. */
export function hasActiveCustomerHandlingContext(
  history: Array<{ sender: string; body: string }>,
  leadRequirement?: string | null,
): boolean {
  if (String(leadRequirement || "").trim()) return true;
  if (hasRecentRequirementContext(history, leadRequirement)) return true;
  const recent = history.slice(-16);
  for (const m of recent) {
    if (m.sender === "agent") return true;
    if (m.sender !== "ai" && m.sender !== "system") continue;
    const body = String(m.body || "");
    if (REPRESENTATIVE_CONTACT_RE.test(body)) return true;
    if (REQUIREMENT_CONTEXT_RE.test(body)) return true;
  }
  return false;
}

/**
 * Soft ping after an active thread: stay silent on acks only.
 * Greetings (Hi/Hello) still get a short “how can I help” — AI-owned chats must not go quiet.
 */
export function shouldSuppressColdGreeting(options: {
  text: string;
  history: Array<{ sender: string; body: string }>;
  leadRequirement?: string | null;
  isGreeting: boolean;
  isAck: boolean;
}): boolean {
  if (options.isGreeting) return false;
  if (!options.isAck) return false;
  if (hasActiveCustomerHandlingContext(options.history, options.leadRequirement)) return true;
  if (!isColdConversationStart(options.history)) return true;
  return false;
}

const PHOTO_ASK_RE =
  /reference|refrence|site\s*photo|gallery|photo|picture|image|\bpic\b|dikhao|dikha|dikhai|project\s*photo|show\s*(me\s*)?(photo|image|pic|picture)|photo\s*bhejo|image\s*bhejo|\bref\b|site\s*ref|install\s*ref|bhejo\s*(photo|image|pic)|send\s*(me\s*)?(a\s*)?(photo|image|pic|picture)|(photo|image|pic|picture).{0,40}(inverter|ups|bess|hybrid|product)|(inverter|ups|bess|hybrid|ongrid|product).{0,40}(photo|image|pic|picture)|reference\s*(photo|image|pic)|install(ation)?s?\s*(photo|image|pic|picture)/i;

const INSTALL_ASK_RE =
  /\b(install(?:ation|ations)?|installed|site\s*photos?|site\s*pics?|project\s*photos?)\b/i;

const SITE_USE_CASE_RE =
  /\b(poultry|broiler|chicken\s*farm|hatchery|farm(?:house)?|hospital|clinic|cold\s*storage|petrol|pump|house|home|residential|office|factory|industrial|hotel|mall)\b/i;

/**
 * Customer wants installation / application / site photos — not a product card.
 * "installations of poultry" must hit this even without the word photo.
 */
export function wantsSiteInstallOrReferencePhotos(text: string): boolean {
  const q = String(text || "").trim();
  if (!q || isEducateOnlyAsk(q)) return false;
  if (PHOTO_ASK_RE.test(q)) return true;
  if (INSTALL_ASK_RE.test(q) && SITE_USE_CASE_RE.test(q)) return true;
  if (
    INSTALL_ASK_RE.test(q) &&
    !/\b(price|quote|quotation|kw|kva|inverter|ups|hybrid|ongrid|catalogue|catalog)\b/i.test(q)
  ) {
    return true;
  }
  return false;
}

export type SalesOwnedContext = {
  owned: boolean;
  salesName: string | null;
  salesPhone: string | null;
  requirement: string | null;
};

/**
 * Partner / dealer WhatsApp business greeting (not an EnerTech product question).
 * Example: "Thank you for contacting AG Renewable… how can we help you? 🎈"
 */
export function isBusinessAutoReplyMessage(text: string): boolean {
  const q = String(text || "").trim();
  if (!q || q.length < 36) return false;
  if (/thank you for contacting/i.test(q) && /how (can|may) we help/i.test(q)) return true;
  if (/thank you for (contacting|reaching)/i.test(q) && /\bservices?\b/i.test(q) && q.length > 50) {
    return true;
  }
  const emojiCount = (q.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emojiCount >= 3 && /how (can|may) we help|thank you for contacting/i.test(q)) return true;
  return false;
}

/** True when a parsed sales name is usable in customer-facing replies (never a single letter). */
export function isPlausibleSalesDisplayName(name: string | null | undefined): boolean {
  const s = String(name || "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length < 2) return false;
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  if (/^(mr|mrs|ms|miss|dr)\.?$/i.test(s)) return false;
  return true;
}

/**
 * Keep honorific + full given name: "Mr. Amol" not "A" or "Mr".
 * Accepts WhatsApp bold markers around the name.
 */
export function normalizeSalesDisplayName(raw: string | null | undefined): string | null {
  let s = String(raw || "")
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/\s+will\b[\s\S]*$/i, "").replace(/[,.;:]+$/g, "").trim();
  const titleMatch = s.match(/^(mr|mrs|ms|miss|dr)\.?\s*(.*)$/i);
  if (titleMatch) {
    const titleKey = titleMatch[1].toLowerCase();
    const rest = titleMatch[2].trim();
    const title =
      titleKey === "miss"
        ? "Miss"
        : `${titleKey.charAt(0).toUpperCase()}${titleKey.slice(1)}.`;
    s = rest ? `${title} ${rest}` : title;
  }
  if (!isPlausibleSalesDisplayName(s)) return null;
  return s;
}

/**
 * Pull assigned representative from requirement_submitted template body.
 * Template example: Our representative *Mr. Amol* will contact you shortly.
 */
export function extractSalesPersonNameFromTemplate(body: string): string | null {
  const text = String(body || "");

  const starredPatterns = [
    /Our representative\s+\*([^*]{2,80})\*/i,
    /representative\s+\*([^*]{2,80})\*/i,
  ];
  for (const re of starredPatterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const name = normalizeSalesDisplayName(m[1]);
      if (name) return name;
    }
  }

  const plainPatterns = [
    /Our representative\s+(Mr\.?\s*[A-Za-z][A-Za-z.'\s-]{1,40}?)\s+will\b/i,
    /representative\s+(Mr\.?\s*[A-Za-z][A-Za-z.'\s-]{1,40}?)\s+will\b/i,
    /\b((?:Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Za-z][A-Za-z.'-]{1,40})\s+will\b/i,
  ];
  for (const re of plainPatterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const name = normalizeSalesDisplayName(m[1]);
      if (name) return name;
    }
  }

  return null;
}

/**
 * Parse sales ownership from requirement_submitted (or similar) outbound in history.
 */
export function resolveSalesOwnedFromHistory(
  history: Array<{ sender: string; body: string }>,
): SalesOwnedContext {
  const recent = history.slice(-24).reverse();
  for (const m of recent) {
    if (m.sender === "customer") continue;
    const body = String(m.body || "");
    const isReqAck =
      /\[Template:\s*requirement_submitted\]/i.test(body) ||
      (/requirement\s*submitted\s*successfully/i.test(body) && REPRESENTATIVE_CONTACT_RE.test(body)) ||
      (/your requirement for/i.test(body) && /will contact you shortly/i.test(body));
    if (!isReqAck) continue;

    const phoneMatch =
      body.match(/(?:reach him at|reach them at|at)\s*\*?(\+?\d[\d\s-]{8,18}\d)\*?/i) ||
      body.match(/\*?(\+?91\d{10})\*?/) ||
      body.match(/\*?([6-9]\d{9})\*?/);
    const reqMatch =
      body.match(/requirement for\s+\*([^*]+)\*/i) ||
      body.match(/requirement for\s+(.+?)\s+has been submitted/i);

    const salesName = extractSalesPersonNameFromTemplate(body);
    const salesPhone = phoneMatch?.[1] ? phoneMatch[1].replace(/\D/g, "") : null;
    const requirement = reqMatch?.[1]?.replace(/\*/g, "").replace(/\s+/g, " ").trim().slice(0, 160) || null;

    return {
      owned: true,
      salesName,
      salesPhone: salesPhone && salesPhone.length >= 10 ? salesPhone : null,
      requirement,
    };
  }
  return { owned: false, salesName: null, salesPhone: null, requirement: null };
}

/** Price / quote / catalogue asks that belong to the assigned sales person. */
export function wantsSalesOwnedCommercialDefer(text: string): boolean {
  const q = String(text || "").trim();
  if (!q) return false;
  if (isEducateOnlyAsk(q)) return false;
  if (PRICE_RE.test(q)) return true;
  if (/\b(quotation|quote|proforma|commercial offer|best price)\b/i.test(q)) return true;
  if (/\b(send|share|bhejo)\b[\s\S]{0,40}\b(price|rate|quote|quotation)\b/i.test(q)) return true;
  if (/\b(price|rate|quote)\b[\s\S]{0,40}\b(send|share|bhejo|for|lucknow|pune|mumbai|delhi)\b/i.test(q)) {
    return true;
  }
  if (/\b(catalogue|catalog|brochure|datasheet)\b/i.test(q)) return true;
  // Generic transactional product ask while sales owns the requirement
  if (hasTransactionalProductSignal(q)) return true;
  return false;
}

export function salesPersonDeferReply(options: {
  lang?: string | null;
  salesName?: string | null;
  salesNameFallback?: string | null;
  salesPhone?: string | null;
  requirement?: string | null;
}): string {
  const lang = (options.lang || "en").toLowerCase();
  const name =
    normalizeSalesDisplayName(options.salesName) ||
    normalizeSalesDisplayName(options.salesNameFallback) ||
    "our sales representative";
  const phone = options.salesPhone ? options.salesPhone.replace(/\D/g, "") : "";
  const phoneBit = phone
    ? lang === "hi" || lang === "mixed"
      ? ` Unse ${phone} pe bhi baat kar sakte ho.`
      : lang === "mr"
        ? ` Tyanna ${phone} var pan contact karu shakta.`
        : ` You may also reach them at ${phone}.`
    : "";

  if (lang === "hi" || lang === "mixed") {
    return `Ji sir — ${name} aapka requirement EnerTech taraf se handle kar rahe hain. Price aur details woh jaldi share karenge.${phoneBit}`
      .replace(/\s+/g, " ")
      .trim();
  }
  if (lang === "mr") {
    return `Ho sir — ${name} tumcha requirement EnerTech kadeun handle karat ahet. Price ani details te lavkar share karneel.${phoneBit}`
      .replace(/\s+/g, " ")
      .trim();
  }
  return `Okay sir — ${name} is handling your requirement from EnerTech. They will share the price and details with you shortly.${phoneBit}`
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * History-first gate: after requirement_submitted + assigned rep, do not price-dump.
 * Autoreply → silent; price/quote/catalogue → defer to sales person.
 */
export function resolveSalesOwnerGate(options: {
  text: string;
  history: Array<{ sender: string; body: string }>;
}): SalesOwnedContext & {
  action: "none" | "silent" | "defer";
} {
  const owned = resolveSalesOwnedFromHistory(options.history);
  if (!owned.owned) return { ...owned, action: "none" };
  if (isBusinessAutoReplyMessage(options.text) || isGreetingOnlyLike(options.text)) {
    return { ...owned, action: "silent" };
  }
  if (wantsSalesOwnedCommercialDefer(options.text)) {
    return { ...owned, action: "defer" };
  }
  return { ...owned, action: "none" };
}

function isGreetingOnlyLike(text: string): boolean {
  const q = String(text || "").trim();
  if (!q || q.length > 48) return false;
  return /^(hi+|hlo|hello|hey+|ho|namaste|namaskar|good\s*(morning|afternoon|evening)|thanks|thank\s*you|ok|okay|ji)[\s!.]*$/i.test(
    q,
  );
}

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
