/**
 * Specialist routing + Test classify helpers.
 * Server `resolveAgentStack` and Agents page share this — keep in sync.
 */
import { isServiceIntent } from "@/lib/conversation-guards";
import { isAckOnlyMessage, isGreetingOnlyMessage, isOffTopicMessage } from "@/lib/enertech-scope";
import { wantsSiteInstallOrReferencePhotos } from "@/lib/conversation-intent";

export type SpecialistRoutingHint = {
  key: string;
  label: string;
  when: string;
};

export type ExtraRoutingMatcher = {
  key: string;
  keywords: string[];
};

export type RoutingOptions = {
  previousKey?: string | null;
  extraMatchers?: ExtraRoutingMatcher[];
};

/** Ordered priority — first match wins (same order as runtime). */
export const SPECIALIST_ROUTING_HINTS: SpecialistRoutingHint[] = [
  { key: "warranty", label: "Warranty", when: "warranty, RMA, claim" },
  { key: "battery", label: "Battery (sizing)", when: "runtime, Ah, kWh, backup minutes — not battery price/buy" },
  { key: "quotation", label: "Quotation", when: "quote, quotation, price list, proforma, commercial offer" },
  {
    key: "followup",
    label: "Follow-up (chat prompt only)",
    when: "follow-up / nurture / remind in the message — not Automation daily campaigns",
  },
  { key: "service", label: "Service", when: "after-sales fault / AMC / repair — not “buy a new UPS”" },
  {
    key: "technical",
    label: "Technical",
    when: "schematic, firmware, diagnostic, wiring, three-phase, installation",
  },
  {
    key: "sales",
    label: "Sales",
    when: "buy, price, cost, discount, demo, dealer, kVA, which UPS/product",
  },
  { key: "email", label: "Email (channel fallback)", when: "email channel when no stronger specialist matches" },
];

export function specialistKeyFromMeta(meta: Record<string, unknown> | null | undefined): string | null {
  const k = meta?.specialist_key;
  return typeof k === "string" && k.trim() ? k.trim() : null;
}

function hasWord(text: string, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return false;
  if (k.length <= 2) return text.includes(k);
  try {
    return new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  } catch {
    return text.includes(k);
  }
}

function matchExtra(text: string, extras: ExtraRoutingMatcher[] | undefined): string | null {
  if (!extras?.length) return null;
  for (const extra of extras) {
    if (!extra.key || extra.key === "support") continue;
    if ((extra.keywords || []).some((kw) => hasWord(text, kw))) return extra.key;
  }
  return null;
}

/** Short confirm / rating follow-up — keep the previous specialist. */
export function isStickyRoutingFollowUp(message?: string): boolean {
  const t = String(message || "").trim();
  if (!t) return true;
  if (isAckOnlyMessage(t) || isGreetingOnlyMessage(t)) return true;
  if (t.length <= 28 && /^(yes|yeah|yep|yup|ok|okay|sure|ji|haan|han|ha|theek|thik|sahi|bilkul)([\s.,!]|$)/i.test(t)) {
    return true;
  }
  if (t.length <= 24 && /^\d+(\.\d+)?\s*(k\.?\s*w|k\.?\s*va|kw|kva)?$/i.test(t)) return true;
  return false;
}

function classifyFromText(channel: string, text: string, extras?: ExtraRoutingMatcher[]): string | null {
  const ch = channel.toLowerCase();

  if (/warrant|rma|\bclaim\b/.test(text)) return "warranty";

  const commercial =
    /\b(price|pricing|cost|rate|quote|quotation|buy|purchase|order|proforma|discount)\b/.test(text);
  const batterySizing = /runtime|backup\s*min|\bah\b|kwh|battery\s*(bank|size|sizing|backup)/.test(text);
  if (batterySizing || (/batter(y|ies)/.test(text) && !commercial)) return "battery";

  if (/quot(e|ation)|price\s*list|commercial\s*offer|proforma/.test(text)) return "quotation";
  if (/follow[\s-]?up|nurture|remind/.test(text)) return "followup";

  const wantsNewUnit = /\b(new\s+(ups|inverter)|replace|buy\s+(a\s+)?(new|another)|purchase)\b/.test(text);
  if (isServiceIntent(text) && !wantsNewUnit) return "service";

  if (/schematic|firmware|diagnostic|wiring|three[\s-]?phase|install(ation)?\b/.test(text)) {
    return "technical";
  }
  if (
    /buy|price|cost|discount|demo|dealer|distributor|\bkva\b|online\s*ups|ups\s*for|which\s*(ups|product)/.test(text)
  ) {
    return "sales";
  }

  const extra = matchExtra(text, extras);
  if (extra) return extra;

  if (ch === "email") return "email";
  return null;
}

/**
 * Specialist domain from the latest message (not the master).
 * Returns null when the master should handle alone — unless previousKey sticks.
 */
export function previewSpecialistKey(
  channel?: string | null,
  message?: string,
  options?: RoutingOptions,
): string | null {
  const ch = (channel || "").toLowerCase();
  const text = (message || "").toLowerCase();
  const previous = options?.previousKey?.trim() || null;
  const classified = classifyFromText(ch, text, options?.extraMatchers);

  if (previous && isStickyRoutingFollowUp(message) && (!classified || classified === previous)) {
    return previous;
  }
  if (classified) return classified;
  if (previous) return previous;
  return null;
}

export function routingHintForKey(key: string): string {
  return SPECIALIST_ROUTING_HINTS.find((h) => h.key === key)?.when || `Key: ${key}`;
}

/** WhatsApp/widget shortcuts that skip the OpenAI agent stack. Prompt-only classify is not enough. */
export function previewChannelShortcut(channel: string | null | undefined, message: string): string | null {
  const ch = (channel || "").toLowerCase();
  const text = String(message || "").trim();
  if (!text) return null;
  if (isOffTopicMessage(text)) return "Off-topic refusal (no specialist prompt)";
  if (wantsSiteInstallOrReferencePhotos(text)) return "Reference / site photos (media shortcut)";
  if (/\b(catalogue|catalog|brochure|datasheet)\b/i.test(text) && /\b(pdf|send|share|bhejo|dikhao)\b/i.test(text)) {
    return "Catalogue PDF shortcut (may skip OpenAI)";
  }
  if (
    (ch === "whatsapp" || ch === "website") &&
    /\b(price|buy|catalogue|catalog|photo|bhejo|dikhao)\b/i.test(text) &&
    /\b(ups|inverter|hybrid|battery|kva|kw)\b/i.test(text)
  ) {
    return "Product pack / cards possible (WhatsApp/website may skip OpenAI)";
  }
  return null;
}
