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
  website: { accent: "#0B2388", fg: "#FFFFFF", label: "Website" },
  wordpress: { accent: "#21759B", fg: "#FFFFFF", label: "WordPress" },
  brainmine: { accent: "#0B2388", fg: "#FFFFFF", label: "Brainmine" },
  api: { accent: "#0B2388", fg: "#FFFFFF", label: "API" },
  webhook: { accent: "#C2410C", fg: "#FFFFFF", label: "Webhook" },
};

export function getChannelBrand(channel: string | null | undefined): ChannelBrand {
  const key = String(channel || "").toLowerCase();
  return BRANDS[key] || BRANDS.website;
}
