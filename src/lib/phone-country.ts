/** Dial codes for website chatbot phone field. Default India (+91). */

export const DEFAULT_PHONE_COUNTRY = "91";

export const PHONE_COUNTRY_OPTIONS: ReadonlyArray<{ code: string; label: string }> = [
  { code: "91", label: "IN" },
  { code: "971", label: "AE" },
  { code: "966", label: "SA" },
  { code: "974", label: "QA" },
  { code: "968", label: "OM" },
  { code: "965", label: "KW" },
  { code: "973", label: "BH" },
  { code: "880", label: "BD" },
  { code: "94", label: "LK" },
  { code: "977", label: "NP" },
  { code: "65", label: "SG" },
  { code: "60", label: "MY" },
  { code: "61", label: "AU" },
  { code: "44", label: "UK" },
  { code: "1", label: "US" },
];

/** Country dial + national digits → WhatsApp-ready digits (e.g. 9198…). */
export function composeInternationalPhone(countryCode: string, national: string): string {
  const cc = countryCode.replace(/\D/g, "") || DEFAULT_PHONE_COUNTRY;
  let nat = national.replace(/\D/g, "");
  if (nat.startsWith("0")) nat = nat.slice(1);
  if (nat.startsWith(cc) && nat.length > cc.length + 6) nat = nat.slice(cc.length);
  if (!nat) return "";
  return `${cc}${nat}`;
}

/** Split a stored full number back into dial code + national for the form. */
export function splitInternationalPhone(stored: string | null | undefined): {
  countryCode: string;
  national: string;
} {
  const digits = (stored || "").replace(/\D/g, "");
  if (!digits) return { countryCode: DEFAULT_PHONE_COUNTRY, national: "" };

  const codes = PHONE_COUNTRY_OPTIONS.map((o) => o.code).sort((a, b) => b.length - a.length);
  for (const code of codes) {
    if (digits.startsWith(code) && digits.length >= code.length + 8) {
      return { countryCode: code, national: digits.slice(code.length) };
    }
  }
  if (digits.length === 10) return { countryCode: DEFAULT_PHONE_COUNTRY, national: digits };
  return { countryCode: DEFAULT_PHONE_COUNTRY, national: digits };
}

export function formatPhoneCountryOption(code: string, label: string) {
  return `${label} +${code}`;
}

/** Display stored digits with leading + for Inbox / CRM. */
export function formatDisplayPhone(stored: string | null | undefined): string {
  const digits = (stored || "").replace(/\D/g, "");
  if (!digits) return "";
  return `+${digits}`;
}
