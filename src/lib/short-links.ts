/**
 * Public short URLs for customer-facing file shares (WhatsApp, chat, email).
 * Full Storage URLs stay in DB; sharing uses /c/{sku}, /d/{documentId}, or /f/{Name.pdf}.
 */

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

  return String(fromProcess || fromVite || fromWindow || "").replace(/\/$/, "");
}

function withBase(path: string): string {
  const base = getAppBaseUrl();
  return base ? `${base}${path}` : path;
}

/** Ensure label ends with .pdf for customer-facing download names. */
export function ensurePdfFileLabel(title: string, fileName?: string | null): string {
  const raw = String(fileName || title || "datasheet").trim() || "datasheet";
  const cleaned = raw.replace(/[\\/]+/g, "-");
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

/** Friendly path segment: Name-of-file-a1b2c3d4.pdf */
export function datasheetFileSlug(documentId: string, title: string, fileName?: string | null): string {
  const label = ensurePdfFileLabel(title, fileName);
  const stem = label
    .replace(/\.pdf$/i, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  const idPart = documentId.replace(/-/g, "").slice(0, 8);
  return `${stem || "datasheet"}-${idPart}.pdf`;
}

/** Path only: /f/E-Series-Solar-aaf86f2d.pdf */
export function shortDatasheetPath(documentId: string, title: string, fileName?: string | null): string {
  const id = documentId.trim();
  if (!id) return "";
  return `/f/${encodeURIComponent(datasheetFileSlug(id, title, fileName))}`;
}

/** Full short URL that still looks like a PDF filename. */
export function shortDatasheetUrl(documentId: string, title: string, fileName?: string | null): string {
  const path = shortDatasheetPath(documentId, title, fileName);
  if (!path) return "";
  const base = getAppBaseUrl();
  // Absolute URL required for WhatsApp / external clients
  if (base) return `${base}${path}`;
  return path;
}

/** Path only: /c/EN-3000X */
export function shortProductCataloguePath(sku: string): string {
  const trimmed = sku.trim();
  if (!trimmed) return "";
  return `/c/${encodeURIComponent(trimmed)}`;
}

/** Full short URL for product catalogue PDF. */
export function shortProductCatalogueUrl(sku: string): string {
  const path = shortProductCataloguePath(sku);
  if (!path) return "";
  const base = getAppBaseUrl();
  // Prefer absolute URL for WhatsApp / external clients
  if (base) return `${base}${path}`;
  return path;
}

/** Path only: /d/{documentId} */
export function shortKnowledgeDocumentPath(documentId: string): string {
  const id = documentId.trim();
  if (!id) return "";
  return `/d/${encodeURIComponent(id)}`;
}

/** Full short URL for a knowledge document. */
export function shortKnowledgeDocumentUrl(documentId: string): string {
  const path = shortKnowledgeDocumentPath(documentId);
  if (!path) return "";
  const base = getAppBaseUrl();
  if (base) return `${base}${path}`;
  return path;
}

/** Detect Supabase public knowledge-bucket URLs. */
export function isKnowledgeStorageUrl(url: string): boolean {
  return /\/storage\/v1\/object\/public\/knowledge\//i.test(url);
}

/** Extract storage path after /public/knowledge/ */
export function storagePathFromPublicUrl(url: string): string | null {
  const m = url.match(/\/storage\/v1\/object\/public\/knowledge\/(.+?)(?:\?|#|$)/i);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** Product catalogue path: {orgId}/products/{productId}/file.pdf */
export function productIdFromStoragePath(storagePath: string): string | null {
  const m = storagePath.match(/\/products\/([0-9a-f-]{36})\//i);
  return m?.[1] || null;
}
