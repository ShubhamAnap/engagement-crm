import type { DbProduct } from "@/lib/db-types";
import { shortProductCatalogueUrl } from "@/lib/short-links";

export function resolveProductCatalogueUrl(product: DbProduct): string | null {
  const raw = product.catalog_pdf_url || null;
  const externalHttps =
    raw && /^https:\/\//i.test(raw) && !/\/storage\/v1\/object\//i.test(raw) ? raw : null;
  // Public WP/CDN PDFs: send the HTTPS URL so WhatsApp/Meta can fetch without Engage proxy.
  if (externalHttps) return externalHttps;
  if (!raw && !product.catalog_pdf_path) return null;
  if (product.sku?.trim()) return shortProductCatalogueUrl(product.sku);
  return raw;
}

/** Public HTTPS image for chat / WhatsApp. */
export function resolveProductImageUrl(product: DbProduct): string | null {
  if (product.image_url && /^https?:\/\//i.test(product.image_url)) return product.image_url;
  if (product.image_path) {
    const base =
      (typeof process !== "undefined" ? process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "" : "") ||
      "";
    const root = String(base).replace(/\/$/, "");
    if (!root) return product.image_url || null;
    return `${root}/storage/v1/object/public/knowledge/${product.image_path.replace(/^\//, "")}`;
  }
  return product.image_url || null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip upload junk like "- Image 2" and duplicated titles. */
export function cleanProductDisplayName(name: string): string {
  let s = String(name || "").trim();
  if (!s) return "EnerTech product";

  s = s.replace(/\s*[-–—]\s*Image\s*\d+\b/gi, " ");
  s = s.replace(/\s+/g, " ").trim();

  // First real product title ending wins (stops gallery name spam).
  // Allow glued duplicates like "Inverter3kW/..." and keep "UPS 10kVA".
  const titled = s.match(
    /^(.+?(?:Hybrid\s+Inverters?|Inverters?|UPS|Batter(?:y|ies)|BESS|Chargers?|Stabilizers?|Converters?|SFC)(?:\s+\d+(?:\.\d+)?\s*(?:kW|kVA|VA)?)?)(?=\d[A-Za-z]|[A-Z][a-z]|[-–—]|$)/i,
  );
  if (titled?.[1] && titled[1].trim().length >= 8) {
    return titled[1].replace(/\s+/g, " ").trim();
  }

  // Exact consecutive duplication: "TitleTitle" or "Title Title"
  for (let len = Math.min(90, Math.floor(s.length / 2)); len >= 12; len--) {
    const unit = s.slice(0, len).trim();
    const rest = s.slice(unit.length).replace(/^\s+/, "");
    if (rest.toLowerCase().startsWith(unit.toLowerCase())) {
      return unit;
    }
  }

  const dup = s.match(/^(.{10,100}?)\s*\1+/i);
  if (dup?.[1]) return dup[1].trim();

  return s.replace(/\s+/g, " ").trim() || "EnerTech product";
}

/** Remove name spam / image labels from description. */
export function cleanProductDescription(desc: string, productName?: string): string {
  let s = String(desc || "").trim();
  if (!s) return "";

  s = s.replace(/\s*[-–—]\s*Image\s*\d+\b/gi, " ");
  s = s.replace(/^features?\s*:\s*/i, "");

  const name = productName ? cleanProductDisplayName(productName) : "";
  if (name.length >= 8) {
    s = s.replace(new RegExp(escapeRegExp(name), "gi"), " ");
  }

  s = s.replace(/\s+/g, " ").trim();
  if (name && s.toLowerCase() === name.toLowerCase()) return "";
  return s;
}

function featureBullets(desc: string, max = 6): string[] {
  const cleaned = desc.trim();
  if (!cleaned) return [];

  const split = cleaned
    .split(/\n+|•|\u2022|(?<=\.)\s+(?=[A-Z])|(?<=;)\s+/)
    .map((p) => p.replace(/^[-–—]\s*/, "").trim())
    .filter((p) => p.length >= 18 && p.length <= 140);

  if (split.length >= 2) {
    return split.slice(0, max).map((p) => (p.endsWith(".") ? p.slice(0, -1) : p));
  }

  if (cleaned.length <= 280) return [cleaned];
  const cut = cleaned.slice(0, 277);
  const lastSpace = cut.lastIndexOf(" ");
  return [`${(lastSpace > 160 ? cut.slice(0, lastSpace) : cut).trim()}…`];
}

function formatPrice(product: DbProduct): string | null {
  if (product.price_label?.trim()) {
    const label = product.price_label.trim();
    return /^[₹rs]/i.test(label) ? label : `₹${label}`;
  }
  if (product.price_paise != null) {
    return `₹${(product.price_paise / 100).toLocaleString("en-IN")}`;
  }
  return null;
}

/**
 * STRICT customer product card — only:
 * Product Name, Price, Features (+ Photo & Catalogue attached separately).
 * No SKU, category, stock, battery, runtime, CTAs, or other metadata.
 */
export function formatProductPackBody(
  product: DbProduct,
  options?: { includeCatalogueUrl?: boolean },
): string {
  const name = cleanProductDisplayName(product.name);
  const price = formatPrice(product);
  const features = featureBullets(cleanProductDescription(product.description || "", product.name));

  const lines: string[] = [name];

  if (price) {
    lines.push("");
    lines.push(`Price: ${price}`);
  }

  if (features.length) {
    lines.push("");
    lines.push("Features:");
    for (const f of features) lines.push(`• ${f}`);
  }

  const catalog = resolveProductCatalogueUrl(product);
  if (options?.includeCatalogueUrl && catalog) {
    lines.push("");
    lines.push(`Catalogue: ${catalog}`);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000);
}

/**
 * WhatsApp caption — same strict fields only (photo + PDF sent as media).
 * Max ~1024 chars.
 */
export function formatProductRecommendationCaption(product: DbProduct): string {
  const name = cleanProductDisplayName(product.name);
  const price = formatPrice(product);
  const features = featureBullets(cleanProductDescription(product.description || "", product.name), 5);

  const lines: string[] = [name];
  if (price) {
    lines.push("");
    lines.push(`Price: ${price}`);
  }
  if (features.length) {
    lines.push("");
    lines.push("Features:");
    for (const f of features) lines.push(`• ${f}`);
  }

  return lines.join("\n").slice(0, 1024);
}

export function productImagePublicUrl(product: DbProduct): string | null {
  return resolveProductImageUrl(product);
}
