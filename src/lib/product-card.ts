import type { DbProduct } from "@/lib/db-types";
import { shortProductCatalogueUrl } from "@/lib/short-links";

export function resolveProductCatalogueUrl(product: DbProduct): string | null {
  if (!product.catalog_pdf_url && !product.catalog_pdf_path) return null;
  if (product.sku?.trim()) return shortProductCatalogueUrl(product.sku);
  return product.catalog_pdf_url || null;
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

/** Website / Inbox body — full product pack text. */
export function formatProductPackBody(product: DbProduct): string {
  const lines: string[] = [product.name];
  if (product.sku) lines.push(`SKU: ${product.sku}`);
  if (product.price_label) lines.push(`Price: ${product.price_label}`);
  else if (product.price_paise != null) {
    lines.push(`Price: ₹${(product.price_paise / 100).toLocaleString("en-IN")}`);
  }
  if (product.category) lines.push(`Category: ${product.category}`);
  if (product.stock_status) lines.push(`Stock: ${product.stock_status}`);
  if (product.battery_spec) lines.push(`Battery: ${product.battery_spec}`);
  if (product.runtime_spec) lines.push(`Runtime: ${product.runtime_spec}`);
  if (product.description?.trim()) {
    lines.push("");
    lines.push(product.description.trim().replace(/\s+/g, " ").slice(0, 600));
  }
  const catalog = resolveProductCatalogueUrl(product);
  if (catalog) {
    lines.push("");
    lines.push(`Catalogue: ${catalog}`);
  }
  lines.push("");
  lines.push("Photo + catalogue attached when available. Ask if you need a formal quotation.");
  return lines.join("\n").slice(0, 3500);
}

/** Caption for WhatsApp product recommendation cards (Path B). Max ~1024 chars. */
export function formatProductRecommendationCaption(product: DbProduct): string {
  const lines: string[] = [`*${product.name}*`];
  if (product.sku) lines.push(`SKU: ${product.sku}`);
  if (product.price_label) lines.push(`Price: ${product.price_label}`);
  else if (product.price_paise != null) {
    lines.push(`Price: ₹${(product.price_paise / 100).toLocaleString("en-IN")}`);
  }
  if (product.category) lines.push(`Category: ${product.category}`);
  if (product.stock_status) lines.push(`Stock: ${product.stock_status}`);

  const features: string[] = [];
  if (product.battery_spec) features.push(`Battery: ${product.battery_spec}`);
  if (product.runtime_spec) features.push(`Runtime: ${product.runtime_spec}`);
  if (product.description?.trim()) {
    const desc = product.description.trim().replace(/\s+/g, " ");
    features.push(desc.length > 280 ? `${desc.slice(0, 277)}…` : desc);
  }
  if (features.length) {
    lines.push("");
    lines.push("*Details*");
    for (const f of features) lines.push(`• ${f}`);
  }

  const catalog = resolveProductCatalogueUrl(product);
  if (catalog) {
    lines.push("");
    lines.push(`Catalogue PDF: ${catalog}`);
  }

  lines.push("");
  lines.push("Ask anything about this model, or say if you want a formal quotation.");
  return lines.join("\n").slice(0, 1024);
}

export function productImagePublicUrl(product: DbProduct): string | null {
  return resolveProductImageUrl(product);
}
