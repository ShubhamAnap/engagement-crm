/**
 * Shared visitor profile rules for in-app ChatWidget and public /embed.
 * Keep UI gates aligned with server hasWebsiteContactDetails (name + email + phone).
 * Location is optional on both — stored when provided, not required for Inbox/welcome.
 */
import { DEFAULT_PHONE_COUNTRY } from "@/lib/phone-country";

export type WidgetVisitorProfile = {
  name: string;
  email: string;
  /** National number only (no country dial). */
  phone: string;
  phoneCountryCode: string;
  company: string;
  location: string;
};

export const EMPTY_WIDGET_PROFILE: WidgetVisitorProfile = {
  name: "",
  email: "",
  phone: "",
  phoneCountryCode: DEFAULT_PHONE_COUNTRY,
  company: "",
  location: "",
};

/** Name + email + phone (≥10 digits). Location optional. */
export function isWidgetProfileComplete(profile: WidgetVisitorProfile): boolean {
  const phoneDigits = profile.phone.replace(/\D/g, "");
  return Boolean(
    profile.name.trim() &&
      profile.email.trim() &&
      profile.email.includes("@") &&
      phoneDigits.length >= 10,
  );
}

export function widgetProfileIncompleteMessage(profile: WidgetVisitorProfile): string {
  const missing: string[] = [];
  if (!profile.name.trim()) missing.push("name");
  if (!profile.email.trim() || !profile.email.includes("@")) missing.push("email");
  if (profile.phone.replace(/\D/g, "").length < 10) missing.push("phone (10+ digits)");
  if (missing.length === 0) return "Please complete your contact details so we can help you.";
  return `Please share your ${missing.join(", ")} so we can help you.`;
}
