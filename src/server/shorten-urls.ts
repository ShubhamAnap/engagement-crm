/**
 * Rewrite long Supabase Storage URLs in AI replies / download lists to short app links.
 * Never leave raw supabase.co/storage links for customers (often blocked / invented / broken).
 */
import { createServiceSupabase } from "@/lib/supabase";
import {
  getAppBaseUrl,
  isKnowledgeStorageUrl,
  productIdFromStoragePath,
  shortDatasheetUrl,
  shortKnowledgeDocumentUrl,
  shortProductCatalogueUrl,
  storagePathFromPublicUrl,
} from "@/lib/short-links";

const BUCKET = "knowledge";
const STORAGE_URL_RE =
  /https?:\/\/[^\s)\]>"']+\/storage\/v1\/object\/public\/knowledge\/[^\s)\]>"']+/gi;
const STORAGE_MD_RE =
  /\[[^\]]*\]\(https?:\/\/[^)]*\/storage\/v1\/object\/public\/knowledge\/[^)]*\)/gi;

function publicFileUrl(path: string): string {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
}

const cache = new Map<string, string>();

/** Make sure WhatsApp / external clients get an absolute https URL. */
export function ensureAbsoluteAppUrl(url: string): string {
  const trimmed = (url || "").trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = getAppBaseUrl();
  if (!base) return trimmed;
  return `${base}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

export async function shortenStorageUrl(url: string): Promise<string> {
  const trimmed = (url || "").trim();
  if (!trimmed || !isKnowledgeStorageUrl(trimmed)) return trimmed;
  if (cache.has(trimmed)) return cache.get(trimmed)!;

  const storagePath = storagePathFromPublicUrl(trimmed);
  if (!storagePath) {
    cache.set(trimmed, "");
    return "";
  }

  const supabase = createServiceSupabase();

  // Product catalogue → /c/{sku}
  const productId = productIdFromStoragePath(storagePath);
  if (productId) {
    const { data: product } = await supabase
      .from("products")
      .select("sku")
      .eq("id", productId)
      .maybeSingle();
    const sku = String(product?.sku || "").trim();
    if (sku) {
      const short = ensureAbsoluteAppUrl(shortProductCatalogueUrl(sku));
      cache.set(trimmed, short);
      return short;
    }
  }

  // Exact storage_path match → friendly /f/Name-id.pdf
  const { data: doc } = await supabase
    .from("knowledge_documents")
    .select("id, title, metadata")
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (doc?.id) {
    const fileName = String((doc.metadata as { fileName?: string } | null)?.fileName || "");
    const short = ensureAbsoluteAppUrl(
      shortDatasheetUrl(String(doc.id), String(doc.title || "datasheet"), fileName || null) ||
        shortKnowledgeDocumentUrl(String(doc.id)),
    );
    cache.set(trimmed, short);
    return short;
  }

  // Fuzzy: match by filename only (do not invent from partial title stems)
  const filePart = storagePath.split("/").pop() || "";
  if (filePart.length >= 3) {
    const orgFromPath = storagePath.split("/")[0] || "";
    let q = supabase
      .from("knowledge_documents")
      .select("id, title, metadata, storage_path")
      .eq("status", "ready")
      .limit(40);
    if (/^[0-9a-f-]{36}$/i.test(orgFromPath)) {
      q = q.eq("org_id", orgFromPath);
    }
    const { data: candidates } = await q;
    const lowerFile = filePart.toLowerCase();
    const hit =
      (candidates || []).find((c) => {
        const fn = String((c.metadata as { fileName?: string } | null)?.fileName || "").toLowerCase();
        const path = String(c.storage_path || "").toLowerCase();
        return fn === lowerFile || path.endsWith(`/${lowerFile}`) || path.endsWith(lowerFile);
      }) || null;
    if (hit?.id) {
      const fileName = String((hit.metadata as { fileName?: string } | null)?.fileName || "");
      const short = ensureAbsoluteAppUrl(
        shortDatasheetUrl(String(hit.id), String(hit.title || "datasheet"), fileName || null),
      );
      cache.set(trimmed, short);
      return short;
    }
  }

  // Unknown / invented Storage URL — drop it (do not pass broken links to customers)
  cache.set(trimmed, "");
  return "";
}

export async function shortenDownloadLinks(
  links: Array<{ title: string; url: string; fileName?: string; documentId?: string }>,
): Promise<Array<{ title: string; url: string; fileName?: string; documentId?: string }>> {
  const out: Array<{ title: string; url: string; fileName?: string; documentId?: string }> = [];
  for (const link of links) {
    const url = isKnowledgeStorageUrl(link.url)
      ? await shortenStorageUrl(link.url)
      : ensureAbsoluteAppUrl(link.url);
    if (!url) continue;
    out.push({
      title: link.title,
      url,
      fileName: link.fileName,
      documentId: link.documentId,
    });
  }
  return out;
}

/** Replace any long knowledge Storage URLs inside assistant text. */
export async function rewriteStorageUrlsInText(text: string): Promise<string> {
  if (!text || !STORAGE_URL_RE.test(text)) return text;
  STORAGE_URL_RE.lastIndex = 0;

  const matches = text.match(STORAGE_URL_RE) || [];
  if (!matches.length) return text;

  let out = text;
  const unique = [...new Set(matches)];
  for (const url of unique) {
    const short = await shortenStorageUrl(url);
    out = out.split(url).join(short || "");
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function stripInventedImageMarkdown(text: string): string {
  return (text || "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\.(?:jpe?g|png|webp|gif)[^)]*\)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Final customer-facing scrub: no supabase storage URLs; attach verified short downloads.
 */
export async function sanitizeAssistantFileLinks(
  text: string,
  downloadLinks: Array<{ title: string; url: string }>,
  options?: { channel?: "whatsapp" | "website" },
): Promise<string> {
  let out = await rewriteStorageUrlsInText(text || "");
  out = stripInventedImageMarkdown(out);
  out = out.replace(STORAGE_MD_RE, "");
  out = out.replace(STORAGE_URL_RE, "");
  out = out.replace(/\[[^\]]*\]\(\s*\)/g, "");
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  const links = downloadLinks
    .map((l) => ({ title: l.title, url: ensureAbsoluteAppUrl(l.url) }))
    .filter((l) => l.url && /^https?:\/\//i.test(l.url));

  if (links.length === 0) return out;

  const alreadyHasShort = links.some(
    (l) => out.includes(l.url) || out.includes("/f/") || out.includes("/c/") || out.includes("/d/"),
  );
  if (alreadyHasShort && links.every((l) => out.includes(l.title) || out.includes(l.url))) {
    return out;
  }

  // Strip leftover invented catalogue dumps, then append verified links
  out = out
    .replace(/\n*Downloads:\n(?:[•\-*].*\n?)+/gi, "")
    .replace(/(?:📄\s*)?\[[^\]]+\.pdf\]\([^)]+\)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // WhatsApp: never wipe a real AI answer. Catalogue PDFs are sent by dedicated handlers
  // ("Here is the catalogue." + sendWhatsAppDocument). Replacing every reply that merely
  // retrieved a KB PDF chunk caused "what is …" questions to become catalogue stubs.
  if (options?.channel === "whatsapp") {
    return out;
  }

  const block = links.map((l) => `📄 [${l.title}](${l.url})`).join("\n");
  return `${out}${out ? "\n\n" : ""}${block}`.trim();
}

export function stripStorageUrlsFromText(text: string): string {
  return (text || "")
    .replace(STORAGE_MD_RE, "")
    .replace(STORAGE_URL_RE, "[file]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function storagePublicUrl(path: string): string {
  return publicFileUrl(path);
}
