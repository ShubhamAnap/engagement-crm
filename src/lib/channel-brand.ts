import { ENERTECH_NAVY_HEX } from "@/lib/brand";

/** Partner brand colors for channel identity. App chrome stays EnerTech navy. */

export type ChannelBrand = {
  accent: string;
  fg: string;
  label: string;
};

const BRANDS: Record<string, ChannelBrand> = {
  whatsapp: { accent: "#25D366", fg: "#FFFFFF", label: "WhatsApp" },
  indiamart: { accent: "#E87722", fg: "#FFFFFF", label: "IndiaMART" },
  tradeindia: { accent: "#1B4F9C", fg: "#FFFFFF", label: "TradeIndia" },
  email: { accent: "#EA4335", fg: "#FFFFFF", label: "Email" },
  facebook: { accent: "#1877F2", fg: "#FFFFFF", label: "Facebook" },
  instagram: { accent: "#E4405F", fg: "#FFFFFF", label: "Instagram" },
  website: { accent: ENERTECH_NAVY_HEX, fg: "#FFFFFF", label: "Website" },
  wordpress: { accent: "#21759B", fg: "#FFFFFF", label: "WordPress" },
  brainmine: { accent: ENERTECH_NAVY_HEX, fg: "#FFFFFF", label: "Brainmine" },
  api: { accent: ENERTECH_NAVY_HEX, fg: "#FFFFFF", label: "API" },
  webhook: { accent: "#C2410C", fg: "#FFFFFF", label: "Webhook" },
};

export function getChannelBrand(channel: string | null | undefined): ChannelBrand {
  const key = String(channel || "").toLowerCase();
  return BRANDS[key] || BRANDS.website;
}

const INBOX_SKINS = new Set([
  "whatsapp",
  "indiamart",
  "tradeindia",
  "email",
  "facebook",
  "instagram",
  "website",
]);

/** Thread wallpaper/bubbles follow the open conversation’s channel. */
export function inboxSkinFor(channel: string | null | undefined): string {
  const key = String(channel || "whatsapp").toLowerCase();
  if (INBOX_SKINS.has(key)) return key;
  if (key === "wordpress" || key === "brainmine" || key === "api") return "website";
  return "website";
}
