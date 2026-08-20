/**
 * Per-workspace module switches, set by platform admins.
 *
 * Stored in `organizations.feature_flags`. An absent key or `true` means enabled, so
 * turning this on for an existing deployment changes nothing until someone explicitly
 * disables a module. Only flags that are actually enforced server-side belong here — a
 * switch that does not block anything is worse than no switch at all.
 */

export type FeatureKey = "ai" | "whatsapp" | "marketplace_sync";

export const FEATURE_KEYS: FeatureKey[] = ["ai", "whatsapp", "marketplace_sync"];

export const FEATURE_CATALOG: Record<FeatureKey, { label: string; description: string }> = {
  ai: {
    label: "AI replies",
    description: "Platform-billed AI answers, agents, and knowledge search.",
  },
  whatsapp: {
    label: "WhatsApp sending",
    description: "Outbound WhatsApp messages, templates, and broadcasts.",
  },
  marketplace_sync: {
    label: "Marketplace sync",
    description: "IndiaMART, TradeIndia, Brainmine, and WordPress lead/catalogue pulls.",
  },
};

export type FeatureFlags = Record<FeatureKey, boolean>;

export function parseFeatureFlags(raw: unknown): FeatureFlags {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as FeatureFlags;
  for (const key of FEATURE_KEYS) {
    out[key] = source[key] === false ? false : true;
  }
  return out;
}

/** Only the disabled flags, i.e. what is worth persisting and displaying. */
export function disabledFeatures(flags: FeatureFlags): FeatureKey[] {
  return FEATURE_KEYS.filter((key) => !flags[key]);
}

export function featureLabel(key: FeatureKey): string {
  return FEATURE_CATALOG[key].label;
}
