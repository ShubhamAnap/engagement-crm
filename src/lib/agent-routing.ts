/**
 * Specialist routing hints (ops UI) + preview classifier.
 * Server `resolveAgentStack` and Agents page share this — keep in sync.
 */
import { isServiceIntent } from "@/lib/conversation-guards";

export type SpecialistRoutingHint = {
  key: string;
  label: string;
  when: string;
};

/** Ordered priority — first match wins (same order as runtime). */
export const SPECIALIST_ROUTING_HINTS: SpecialistRoutingHint[] = [
  { key: "warranty", label: "Warranty", when: "warranty, RMA, claim" },
  { key: "battery", label: "Battery", when: "battery, runtime, Ah, kWh, backup minutes" },
  { key: "quotation", label: "Quotation", when: "quote, quotation, price list, proforma, commercial offer" },
  {
    key: "followup",
    label: "Follow-up (chat)",
    when: "follow-up / nurture / remind in the message — not the Automation daily campaign",
  },
  { key: "service", label: "Service", when: "after-sales service / fault / complaint intent" },
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
  { key: "email", label: "Email", when: "email channel fallback when no stronger match" },
];

/**
 * Specialist domain from the latest message (not the master).
 * Returns null when the master should handle alone.
 */
export function previewSpecialistKey(
  channel?: string | null,
  message?: string,
): string | null {
  const ch = (channel || "").toLowerCase();
  const text = (message || "").toLowerCase();

  if (
    ch === "email" &&
    /warrant|rma|claim|quot|batter|runtime|install|technical|schematic/.test(text) === false
  ) {
    if (!text.trim()) return "email";
  }

  if (/warrant|rma|\bclaim\b/.test(text)) return "warranty";
  if (/batter(y|ies)|runtime|backup\s*min|\bah\b|kwh/.test(text)) return "battery";
  if (/quot(e|ation)|price\s*list|commercial\s*offer|proforma/.test(text)) return "quotation";
  if (/follow[\s-]?up|nurture|remind/.test(text)) return "followup";
  if (isServiceIntent(text)) return "service";
  if (/schematic|firmware|diagnostic|wiring|three[\s-]?phase|install(ation)?\b/.test(text)) {
    return "technical";
  }
  if (
    /buy|price|cost|discount|demo|dealer|distributor|\bkva\b|online\s*ups|ups\s*for|which\s*(ups|product)/.test(
      text,
    )
  ) {
    return "sales";
  }
  if (ch === "email") return "email";
  return null;
}

export function routingHintForKey(key: string): string {
  return SPECIALIST_ROUTING_HINTS.find((h) => h.key === key)?.when || `Key: ${key}`;
}
