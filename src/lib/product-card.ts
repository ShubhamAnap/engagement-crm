import type { DbProduct } from "@/lib/db-types";
import { shortProductCatalogueUrl } from "@/lib/short-links";

function catalogueUrl(product: DbProduct): string | null {
  if (!product.catalog_pdf_url && !product.catalog_pdf_path) return null;
  if (product.sku?.trim()) return shortProductCatalogueUrl(product.sku);
  return product.catalog_pdf_url || null;
}

/** Caption for WhatsApp product recommendation cards (Path B). Max ~1024 chars. */
export function formatProductRecommendationCaption(product: DbProduct): string {
  const lines: string[] = [`*${product.name}*`];
  if (product.sku) lines.push(`SKU: ${product.sku}`);
  if (product.price_label) lines.push(`Price: ${product.price_label}`);
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
    lines.push("*Features*");
    for (const f of features) lines.push(`• ${f}`);
  }

  const catalog = catalogueUrl(product);
  if (catalog) {
    lines.push("");
    lines.push(`Catalogue PDF: ${catalog}`);
  }

  lines.push("");
  lines.push('Reply "interested" for a quote, or ask any question about this model.');
  return lines.join("\n").slice(0, 1024);
}

export function productImagePublicUrl(product: DbProduct): string | null {
  return product.image_url || null;
}
