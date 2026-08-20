/** Shared email validation for signup / onboarding. */

export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "mail.com",
  "protonmail.com",
  "yandex.com",
  "zoho.com",
  "live.com",
  "msn.com",
  "me.com",
  "inbox.com",
  "gmx.com",
  "rediffmail.com",
  "yahoo.co.in",
  "yahoo.in",
]);

export function isBusinessEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return !FREE_EMAIL_DOMAINS.has(domain);
}

export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}
