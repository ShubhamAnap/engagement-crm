/** Public app URL helpers for short catalogue links. */

export function getAppBaseUrl(): string {
  const fromProcess =
    typeof process !== "undefined"
      ? process.env.VITE_APP_URL || process.env.APP_URL || ""
      : "";
  let fromVite = "";
  try {
    fromVite = String(import.meta.env?.VITE_APP_URL || "");
  } catch {
    fromVite = "";
  }
  const fromWindow =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";

  const base = String(fromProcess || fromVite || fromWindow || "").replace(/\/$/, "");
  return base;
}

/** Path only: /c/EN-3000X */
export function shortProductCataloguePath(sku: string): string {
  const trimmed = sku.trim();
  if (!trimmed) return "";
  return `/c/${encodeURIComponent(trimmed)}`;
}

/** Full short URL for WhatsApp / chat / emails. Falls back to path if base URL unknown. */
export function shortProductCatalogueUrl(sku: string): string {
  const path = shortProductCataloguePath(sku);
  if (!path) return "";
  const base = getAppBaseUrl();
  return base ? `${base}${path}` : path;
}
