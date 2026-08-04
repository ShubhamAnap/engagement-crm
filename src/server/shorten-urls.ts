/**
 * Rewrite long Supabase Storage URLs in AI replies / download lists to short app links.
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

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const BUCKET = "knowledge";

function publicFileUrl(path: string): string {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
}

const cache = new Map<string, string>();

export async function shortenStorageUrl(url: string): Promise<string> {
  const trimmed = (url || "").trim();
  if (!trimmed || !isKnowledgeStorageUrl(trimmed)) return trimmed;
  if (cache.has(trimmed)) return cache.get(trimmed)!;

  const storagePath = storagePathFromPublicUrl(trimmed);
  if (!storagePath) return trimmed;

  const supabase = createServiceSupabase();

  // Product catalogue → /c/{sku}
  const productId = productIdFromStoragePath(storagePath);
  if (productId) {
    const { data: product } = await supabase
      .from("products")
      .select("sku")
      .eq("org_id", ORG_ID)
      .eq("id", productId)
      .maybeSingle();
    const sku = String(product?.sku || "").trim();
    if (sku) {
      const short = shortProductCatalogueUrl(sku);
      if (short.startsWith("http") || getAppBaseUrl()) {
        cache.set(trimmed, short);
        return short;
      }
    }
  }

  // Knowledge document → friendly /f/Name-id.pdf when possible
  const { data: doc } = await supabase
    .from("knowledge_documents")
    .select("id, title, metadata")
    .eq("org_id", ORG_ID)
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (doc?.id) {
    const fileName = String((doc.metadata as { fileName?: string } | null)?.fileName || "");
    const short = shortDatasheetUrl(String(doc.id), String(doc.title || "datasheet"), fileName || null);
    cache.set(trimmed, short || shortKnowledgeDocumentUrl(String(doc.id)));
    return cache.get(trimmed)!;
  }

  cache.set(trimmed, trimmed);
  return trimmed;
}

export async function shortenDownloadLinks(
  links: Array<{ title: string; url: string }>,
): Promise<Array<{ title: string; url: string }>> {
  const out: Array<{ title: string; url: string }> = [];
  for (const link of links) {
    out.push({ title: link.title, url: await shortenStorageUrl(link.url) });
  }
  return out;
}

/** Replace any long knowledge Storage URLs inside assistant text. */
export async function rewriteStorageUrlsInText(text: string): Promise<string> {
  if (!text || !isKnowledgeStorageUrl(text)) return text;

  const re = /https?:\/\/[^\s)\]>"']+\/storage\/v1\/object\/public\/knowledge\/[^\s)\]>"']+/gi;
  const matches = text.match(re) || [];
  if (!matches.length) return text;

  let out = text;
  const unique = [...new Set(matches)];
  for (const url of unique) {
    const short = await shortenStorageUrl(url);
    if (short !== url) {
      out = out.split(url).join(short);
    }
  }
  return out;
}

export function storagePublicUrl(path: string): string {
  return publicFileUrl(path);
}
