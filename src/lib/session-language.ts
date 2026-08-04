/**
 * Session language from customer chat context.
 * Supports English, Hindi/Hinglish, Marathi, and mixed (common in Maharashtra).
 * Prefer session history over a single message; never flip to Hindi on "please/plz".
 */

export type SessionLang = "en" | "hi" | "mr" | "mixed";

export type LangScores = { en: number; hi: number; mr: number };

const DEVANAGARI = /[\u0900-\u097F]/;

/** Explicit language switch requests. */
export function explicitLanguageRequest(text: string): SessionLang | null {
  const q = String(text || "").toLowerCase();
  if (
    /\b(in\s*english|talk\s*in\s*english|speak\s*(in\s*)?english|english\s*(please|plz)|reply\s*in\s*english|english\s*me\s*(baat|bolo)|angrezi)\b/i.test(
      q,
    )
  ) {
    return "en";
  }
  if (
    /\b(in\s*hindi|talk\s*in\s*hindi|speak\s*(in\s*)?hindi|hindi\s*(please|plz|me|mein)|hindi\s*me\s*(baat|bolo)|हिंदी|हिन्दी)\b/i.test(
      q,
    ) || /[\u0900-\u097F].*हिंद/.test(text)
  ) {
    return "hi";
  }
  if (
    /\b(in\s*marathi|talk\s*in\s*marathi|speak\s*(in\s*)?marathi|marathi\s*(please|plz|madhe|me)|marathi\s*(madhe|me)\s*(bol|bolaa)|मराठी)\b/i.test(
      q,
    )
  ) {
    return "mr";
  }
  return null;
}

const HI_ROMAN =
  /\b(haan|han|nahi|nahin|theek|thik|thoda|kijiye|kripya|kripa|baat|karo|karna|jaldi|abhi|aapko|aap|mujhe|mera|meri|kharab|dikhao|bhejo|chahiye|namaste|namaskar|kya|hai|hain|hoon|hun|kaise|kaisa|kitna|kitne|accha|acha|sahi|galat|zaroor|bilkul|mat|matlb|matlab|kyunki|lekin|phir|abhi|baad|mein|me\s+batao|batao|bolo|sunao)\b/i;

const MR_ROMAN =
  /\b(ahe|aahe|kay|kay\s*zhala|tumhi|tumhala|mala|majha|mazi|nako|nahi\s*re|barobar|kasa|kashi|kuthe|kadhi|aadhi|pudhe|madhe|ho\s*nay|hoy|nahi\s*hoy|sangaa|sang|dyaycha|pahije|zala|zalay|bagha|baghun|thamb|thamba|krupa|namaskar|shubh)\b/i;

/** Marathi-leaning Devanagari tokens (approx.). */
const MR_DEV =
  /आहे|काय|तुम्ही|मला|माझा|नको|बरोबर|कसा|कुठे|मध्ये|पाहिजे|झालं|झाले|सांगा|थांबा|कृपया|मराठी/i;

/** Hindi-leaning Devanagari tokens (approx.). */
const HI_DEV =
  /है|हैं|क्या|आप|मुझे|मेरा|नहीं|ठीक|थोड़ा|बात|करो|जल्दी|चाहिए|नमस्ते|हिंदी|हिन्दी|कृपया|बताओ|बोलो/i;

function scoreMessage(text: string): LangScores {
  const t = String(text || "").trim();
  const q = t.toLowerCase();
  const scores: LangScores = { en: 0, hi: 0, mr: 0 };
  if (!t) return scores;

  // Short English acks / product talk don't force language
  if (/^(ok|okay|oke|k|kk|yes|no|sure|thanks|thank\s*you|hi|hello|hey)[\s!.]*$/i.test(t)) {
    scores.en += 0.2;
    return scores;
  }

  if (DEVANAGARI.test(t)) {
    if (MR_DEV.test(t)) scores.mr += 3;
    if (HI_DEV.test(t)) scores.hi += 3;
    if (scores.mr === 0 && scores.hi === 0) {
      // Unclear Devanagari — slight Hindi bias (common in India WA), but low
      scores.hi += 1.5;
    }
  }

  const hiHits = (q.match(HI_ROMAN) || []).length;
  const mrHits = (q.match(MR_ROMAN) || []).length;
  scores.hi += hiHits * 1.2;
  scores.mr += mrHits * 1.4;

  // Latin letters without Indic markers → English weight
  const latinWords = (q.match(/[a-z]{3,}/g) || []).length;
  if (latinWords > 0 && hiHits === 0 && mrHits === 0 && !DEVANAGARI.test(t)) {
    scores.en += Math.min(3, latinWords * 0.6);
  } else if (latinWords > 0) {
    scores.en += Math.min(1.5, latinWords * 0.25);
  }

  return scores;
}

function pickFromScores(scores: LangScores): SessionLang {
  const { en, hi, mr } = scores;
  const total = en + hi + mr;
  if (total < 0.5) return "en";

  const top = Math.max(en, hi, mr);
  const second = [en, hi, mr].sort((a, b) => b - a)[1] || 0;

  // Mixed: two languages both meaningful
  if (top > 0.8 && second > 0.8 && second / top >= 0.45) {
    return "mixed";
  }
  if (mr >= hi && mr >= en && mr >= 0.8) return "mr";
  if (hi >= en && hi >= 0.8) return "hi";
  return "en";
}

/** Detect language of one customer message. */
export function detectMessageLang(text: string): SessionLang {
  const forced = explicitLanguageRequest(text);
  if (forced) return forced;
  return pickFromScores(scoreMessage(text));
}

/**
 * Resolve reply language for this turn from:
 * - explicit switch in latest message
 * - stored session preference
 * - recent customer messages (session context)
 * - latest message
 */
export function resolveSessionLang(opts: {
  latestText: string;
  storedLang?: string | null;
  recentCustomerTexts?: string[];
}): SessionLang {
  const forced = explicitLanguageRequest(opts.latestText);
  if (forced) return forced;

  const recent = (opts.recentCustomerTexts || []).slice(-8);
  const combined = [...recent, opts.latestText].filter(Boolean);

  const scores: LangScores = { en: 0, hi: 0, mr: 0 };
  combined.forEach((msg, i) => {
    const w = 1 + i * 0.15; // newer messages weigh more
    const s = scoreMessage(msg);
    scores.en += s.en * w;
    scores.hi += s.hi * w;
    scores.mr += s.mr * w;
  });

  const fromHistory = pickFromScores(scores);
  const stored = normalizeStoredLang(opts.storedLang);

  // If history is weak and we have a stored preference, keep it
  const strength = scores.en + scores.hi + scores.mr;
  if (strength < 1.2 && stored) return stored;

  // Explicit English history / stored en wins over weak hi from "ji" alone
  if (fromHistory === "en" && stored && stored !== "en") {
    // Customer speaking English this turn — switch
    return "en";
  }

  return fromHistory;
}

export function normalizeStoredLang(v: unknown): SessionLang | null {
  if (v === "en" || v === "hi" || v === "mr" || v === "mixed") return v;
  if (v === "hinglish") return "mixed";
  return null;
}

/** Resolve language from Inbox message history + stored preference. */
export function sessionLangFromHistory(
  latestText: string,
  history: Array<{ sender?: string; body?: string }> | null | undefined,
  storedLang?: string | null,
): SessionLang {
  const recent = (history || [])
    .filter((m) => String(m.sender || "") === "customer" && String(m.body || "").trim())
    .map((m) => String(m.body))
    .slice(-8);
  return resolveSessionLang({
    latestText,
    storedLang,
    recentCustomerTexts: recent,
  });
}

/** Instruction block for OpenAI — match customer session language. */
export function languageSystemInstruction(lang: SessionLang): string {
  switch (lang) {
    case "hi":
      return "Reply in Hindi or natural Hinglish (Roman or Devanagari), matching how the customer writes. Keep product names (UPS, kVA, EnerTech) in English. Do not suddenly switch to pure English unless they ask.";
    case "mr":
      return "Reply in Marathi or natural Marathi-English mix, matching how the customer writes. Keep product names (UPS, kVA, EnerTech) in English. Do not suddenly switch to pure English unless they ask.";
    case "mixed":
      return "The customer mixes languages (Hindi/Marathi/English). Reply in the same mixed style they use — natural Hinglish or Marathi-English. Keep product names in English. Mirror their latest message tone.";
    default:
      return "Reply in clear professional English. Do not reply in Hindi or Marathi unless the customer is clearly writing in those languages. Words like please/plz/sir/ok are English — stay in English.";
  }
}

export function humanWaitReplyForLang(lang: SessionLang): string {
  switch (lang) {
    case "hi":
      return "Theek hai sir, please thoda wait kijiye — main aapko jaldi reply karta hoon.";
    case "mr":
      return "Theek aahe sir, thoda thamba — mi lavkar reply karto.";
    case "mixed":
      return "Theek hai sir, thoda wait — main jaldi reply karta hoon.";
    default:
      return "Okay sir, please wait a moment — I will get back to you shortly.";
  }
}

export function languageSwitchAck(lang: SessionLang): string {
  switch (lang) {
    case "hi":
      return "Ji sir — ab Hindi/Hinglish me baat karta hoon. Please thoda wait, main jaldi reply karta hoon.";
    case "mr":
      return "Ho sir — ata Marathi madhe bolto. Thoda thamba, mi lavkar reply karto.";
    case "mixed":
      return "Theek hai sir — same style me baat karta hoon. Thoda wait, jaldi reply karta hoon.";
    default:
      return "Sure sir — I'll reply in English. Please wait a moment, I will get back to you shortly.";
  }
}

export function greetingReplyForLang(lang: SessionLang): string {
  switch (lang) {
    case "hi":
      return "Namaste! EnerTech products ya service me kaise madad karu?";
    case "mr":
      return "Namaskar! EnerTech product kinva service sathi madat karu ka?";
    case "mixed":
      return "Namaste! EnerTech products / service me kaise help karu?";
    default:
      return "Hello! How can I help you with EnerTech products or services?";
  }
}

export function offTopicReplyForLang(lang: SessionLang): string {
  switch (lang) {
    case "hi":
      return "Main sirf EnerTech products aur services me madad kar sakta hoon. Dhanyavaad.";
    case "mr":
      return "Mi fakt EnerTech products ani services sathi madat karu shakto. Dhanyavad.";
    case "mixed":
      return "Main sirf EnerTech products aur services me help kar sakta hoon. Thank you.";
    default:
      return "I can only help you with EnerTech products and services. Thank you.";
  }
}

export function referencePhotosReplyForLang(lang: SessionLang, more = false): string {
  if (more) {
    switch (lang) {
      case "hi":
        return "Sir, yeh aur kuch reference photos hain.";
      case "mr":
        return "Sir, he thode ajun reference photos aahet.";
      case "mixed":
        return "Sir, yeh aur reference photos hain.";
      default:
        return "Sir, here are some more reference photos.";
    }
  }
  switch (lang) {
    case "hi":
      return "Sir, yeh kuch reference photos hain.";
    case "mr":
      return "Sir, he reference photos aahet.";
    case "mixed":
      return "Sir, yeh reference photos hain.";
    default:
      return "Sir, here are some reference photos.";
  }
}

export function serviceTicketPromptForLang(
  lang: SessionLang,
  missing: "done" | "model" | "serial" | "fault" | "city",
): string {
  if (missing === "done") {
    switch (lang) {
      case "hi":
        return "Dhanyavaad sir — details note kar liye. Please thoda wait, main jaldi update karta hoon.";
      case "mr":
        return "Dhanyavad sir — details note kele. Thoda thamba, mi lavkar update karto.";
      case "mixed":
        return "Thank you sir — details note kar liye. Thoda wait, jaldi update karta hoon.";
      default:
        return "Thank you sir — I have noted the details. Please wait a moment, I will update you shortly.";
    }
  }
  if (missing === "model") {
    switch (lang) {
      case "hi":
        return "Sure sir — product model bataiye (jaise inverter / UPS model).";
      case "mr":
        return "Sure sir — product model sanga (inverter / UPS model).";
      case "mixed":
        return "Sure sir — product model batao (inverter / UPS model).";
      default:
        return "Sure sir — please share the product model (e.g. inverter / UPS model).";
    }
  }
  if (missing === "serial") {
    switch (lang) {
      case "hi":
        return "Product label se serial number share kijiye (agar available ho).";
      case "mr":
        return "Product label varil serial number share kara (aslyas).";
      case "mixed":
        return "Serial number share karo label se (agar available ho).";
      default:
        return "Please share the serial number from the product label (if available).";
    }
  }
  if (missing === "fault") {
    switch (lang) {
      case "hi":
        return "Problem short me bataiye (kya nahi chal raha / koi error).";
      case "mr":
        return "Problem thodkyat sanga (kay chalat nahi / error).";
      case "mixed":
        return "Problem short me batao (kya nahi chal raha / error).";
      default:
        return "Please describe the problem briefly (what is not working / any error).";
    }
  }
  switch (lang) {
    case "hi":
      return "Site city / location bataiye.";
    case "mr":
      return "Site city / location sanga.";
    case "mixed":
      return "Site city / location batao.";
    default:
      return "Please share the site city / location.";
  }
}
