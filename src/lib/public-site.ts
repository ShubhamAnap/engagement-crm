/**
 * Public SaaS packaging — support contacts, SLA, and marketing copy shared across
 * pricing / features / legal / support pages. Keep secrets out of this file.
 */

export const PRODUCT_NAME = "Engage CRM";

export const SUPPORT_EMAIL = "support@engagecrm.com";
export const SALES_EMAIL = "sales@engagecrm.com";
export const PRIVACY_EMAIL = "privacy@engagecrm.com";

/** India Phase 1 business hours (IST). */
export const SUPPORT_SLA_INDIA = {
  region: "India",
  hours: "Mon–Sat, 10:00–19:00 IST",
  firstResponse: "Within 1 business day",
  channels: ["Email", "WhatsApp (on request for paid plans)"],
} as const;

/** Phase 2 English / worldwide async SLA. */
export const SUPPORT_SLA_GLOBAL = {
  region: "Worldwide (English)",
  hours: "Async — responses Mon–Fri overlapping IST mornings / EU afternoons",
  firstResponse: "Within 1 business day (weekday)",
  channels: ["Email"],
} as const;

export const DEMO_VIDEO_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { VITE_DEMO_VIDEO_URL?: string } }).env?.VITE_DEMO_VIDEO_URL) ||
  "";

export const MARKETING_FEATURES = [
  {
    title: "Shared inbox",
    body: "WhatsApp, email, web chat, and social threads in one workspace for your team.",
  },
  {
    title: "AI-assisted replies",
    body: "Grounded answers from your knowledge base with human takeover when needed.",
  },
  {
    title: "Leads & pipeline",
    body: "Capture marketplace and channel leads, assign owners, and track status.",
  },
  {
    title: "Multi-workspace SaaS",
    body: "Each organization is isolated — invite your team, connect your own channels.",
  },
  {
    title: "Usage-aware billing",
    body: "Plan caps for AI spend, WhatsApp volume, and seats — with grace when you are close.",
  },
  {
    title: "Platform ops",
    body: "Trials, modules, and risk controls so we can support customers at scale.",
  },
] as const;

export const ONBOARDING_CHECKLIST = [
  {
    id: "channels",
    title: "Connect a channel",
    description: "WhatsApp, email, or website widget — so messages land in Inbox.",
    href: "/channels",
  },
  {
    id: "invite",
    title: "Invite your team",
    description: "Add agents so the inbox is shared, not stuck on one phone.",
    href: "/settings",
  },
  {
    id: "knowledge",
    title: "Add knowledge",
    description: "Upload FAQs or product docs so AI replies stay on-brand.",
    href: "/knowledge",
  },
  {
    id: "inbox",
    title: "Send a test reply",
    description: "Open Inbox, take over or let AI draft — confirm the loop works.",
    href: "/inbox",
  },
  {
    id: "billing",
    title: "Review plan & billing",
    description: "See Free limits or upgrade when you are ready for more volume.",
    href: "/settings",
  },
] as const;
