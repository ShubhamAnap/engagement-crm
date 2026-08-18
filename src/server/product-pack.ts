import type { DbProduct } from "@/lib/db-types";
import { isAckOnlyMessage, isGreetingOnlyMessage } from "@/lib/enertech-scope";
import { isServiceIntent } from "@/lib/conversation-guards";
import {
  isInformationalProductAsk,
  hasTransactionalProductSignal,
  isEducateOnlyAsk,
  wantsSiteInstallOrReferencePhotos,
} from "@/lib/conversation-intent";
import { createServiceSupabase } from "@/lib/supabase";
import {
  formatProductPackBody,
  formatProductRecommendationCaption,
  formatPrice,
  resolveProductCatalogueUrl,
  resolveProductImageUrl,
  cleanProductDisplayName,
  cleanProductDescription,
  inheritCategoryCatalogue,
  normalizeCategoryKey,
  type CategoryCatalogueLookup,
} from "@/lib/product-card";

export {
  isInformationalProductAsk,
  hasTransactionalProductSignal,
  isEducateOnlyAsk,
} from "@/lib/conversation-intent";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

async function loadCategoryCatalogueLookup(): Promise<CategoryCatalogueLookup> {
  const supabase = createServiceSupabase();
  const map: CategoryCatalogueLookup = new Map();
  const { data, error } = await supabase
    .from("product_category_catalogues")
    .select("category_key, catalog_pdf_url, catalog_pdf_path")
    .eq("org_id", ORG_ID);
  if (error) {
    if (!/does not exist|schema cache|product_category_catalogues/i.test(error.message)) {
      console.warn("loadCategoryCatalogueLookup", error.message);
    }
    return map;
  }
  for (const row of data || []) {
    const key = String((row as { category_key?: string }).category_key || "");
    if (key) map.set(key, row as { catalog_pdf_url?: string | null; catalog_pdf_path?: string | null });
  }
  return map;
}

function withInheritedCatalogues(
  products: DbProduct[],
  lookup: CategoryCatalogueLookup,
): DbProduct[] {
  return products.map((p) => inheritCategoryCatalogue(p, lookup));
}

const KW_RE = /(\d+(?:\.\d+)?)\s*(k\.?\s*w|k\.?\s*va|kw|kva)\b/i;
const PRODUCT_WORD_RE =
  /\b(inverters?|ups|hybrids?|pcu|batter(?:y|ies)|bess|ongrid|on[\s-]?grid|off[\s-]?grid|solar|e[\s-]?series|reefi|stabilizers?|chargers?|sfc|products?|models?|hf|lf)\b/i;
const DETAIL_RE =
  /\b(price|pricing|cost|rate|quote|quotation|kitna|kitne|rs\.?|₹|inr|details?|specs?|specification|send|bhejo|dikhao|info|information|available|stock)\b/i;
const PRICE_RE = /\b(price|pricing|cost|rate|quote|quotation|kitna|kitne|rs\.?|₹|inr)\b/i;
/** Use-case / site words customers paste casually */
const USE_CASE_RE =
  /\b(home|house|residential|resident|domestic|office|shop|clinic|hospital|farm|poultry|commercial|industrial|villa|apartment|flat)\b/i;
/** Category / series labels from catalogue */
const CATEGORY_LABEL_RE =
  /\b(hf|lf|high\s*frequency|low\s*frequency|e[\s-]?series|reefi|hybrid|pcu|ongrid|off[\s-]?grid|bess|sfc|servo|online|offline|3\s*ph|1\s*ph|three[\s-]?phase|vdc)\b/i;

export type ProductPackResult =
  | { mode: "none" }
  | {
      mode: "match";
      products: DbProduct[];
      message: string;
    }
  | {
      mode: "carousel";
      products: DbProduct[];
      message: string;
    }
  | {
      mode: "clarify";
      products: DbProduct[];
      message: string;
    };

export type ProductCarouselCard = {
  id: string;
  name: string;
  imageUrl: string | null;
};

export function toCarouselCards(products: DbProduct[]): ProductCarouselCard[] {
  return products.map((p) => ({
    id: p.id,
    name: cleanProductDisplayName(p.name),
    imageUrl: resolveProductImageUrl(p),
  }));
}

export function extractRequestedKw(text: string): number | null {
  const m = String(text || "").match(KW_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Battery / DC bus voltage from "360vdc" / "360 V DC". */
export function extractRequestedVdc(text: string): number | null {
  const m = String(text || "").match(/(\d{2,4})\s*v\s*d\.?c\b|(\d{2,4})\s*vdc\b/i);
  if (!m) return null;
  const n = Number(m[1] || m[2]);
  return Number.isFinite(n) && n >= 12 && n <= 1000 ? n : null;
}

/** Infer kW/kVA from product fields (name "3kW Hybrid", SKU EN-3000 → 3). */
export function productPowerKw(product: DbProduct): number | null {
  const blob = [
    product.name,
    product.sku,
    product.category,
    product.description,
    product.battery_spec,
    product.runtime_spec,
    JSON.stringify(product.specs || {}),
  ]
    .filter(Boolean)
    .join(" ");

  const direct = extractRequestedKw(blob);
  if (direct != null) return direct;

  const sku = String(product.sku || "");
  const skuKw = sku.match(/(\d+(?:\.\d+)?)\s*k/i);
  if (skuKw) {
    const n = Number(skuKw[1]);
    if (Number.isFinite(n) && n > 0 && n <= 500) return n;
  }

  // EN-3000 / 5000X style → kVA = value/1000
  const rating = sku.match(/(?:^|[-_\s])(\d{3,5})(?:[-_x]|$)/i);
  if (rating) {
    const v = Number(rating[1]);
    if (v >= 500 && v <= 50000) return Math.round((v / 1000) * 100) / 100;
  }

  return null;
}

/**
 * Broad intent: map casual customer words → product family.
 * Examples: home/residential → HF/hybrid, "HF" → hf, solar → solar.
 */
export function categoryHint(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bhf\b|high\s*frequency/.test(t)) return "hf";
  if (/\blf\b|low\s*frequency/.test(t)) return "lf";
  if (/\bhybrids?\b|\bpcu\b/.test(t)) return "hybrid";
  if (/\bongrid|on[\s-]?grid|grid[\s-]?tie\b/.test(t)) return "ongrid";
  if (/\boff[\s-]?grid\b/.test(t)) return "offgrid";
  if (/\bbess\b/.test(t)) return "bess";
  if (/\bbatter(?:y|ies)\b/.test(t)) return "battery";
  if (/\bups\b/.test(t)) return "ups";
  if (/\binverters?\b/.test(t)) return "inverter";
  if (/\bsolar\b/.test(t)) return "solar";
  if (/\be[\s-]?series\b/.test(t)) return "e-series";
  if (/\breefi\b/.test(t)) return "reefi";
  // Home / residential customers usually need HF hybrid / inverter range
  if (USE_CASE_RE.test(t)) return "hf";
  return null;
}

/**
 * True when customer wants product cards / packs (browse or buy).
 * Educational asks ("what is…") go to AI + Knowledge Base instead.
 */
export function wantsProductPack(text: string): boolean {
  const q = String(text || "").trim();
  if (!q || q.length > 280) return false;
  if (isAckOnlyMessage(q) || isGreetingOnlyMessage(q)) return false;
  if (isServiceIntent(q)) return false;
  if (wantsSiteInstallOrReferencePhotos(q)) return false;

  // Learn-first for complex power products (industry practice + India WhatsApp Hinglish)
  if (isEducateOnlyAsk(q)) {
    return false;
  }

  const hasKw = KW_RE.test(q);
  const hasProduct = PRODUCT_WORD_RE.test(q);
  const priceAsk = PRICE_RE.test(q);
  const wantsDetail = DETAIL_RE.test(q);
  const useCase = USE_CASE_RE.test(q);
  const categoryLabel = CATEGORY_LABEL_RE.test(q);
  const transactional = hasTransactionalProductSignal(q);

  if (hasKw && (hasProduct || priceAsk || wantsDetail || useCase || categoryLabel || transactional)) return true;
  if (hasKw && q.length <= 64) return true;
  // Short product/category browse ("solar hybrid", "HF inverter") — not "what is…"
  if (hasProduct && q.length <= 80) return true;
  if (hasProduct && (priceAsk || transactional)) return true;
  if (categoryLabel && q.length <= 80) return true;
  if (useCase && (hasProduct || hasKw || categoryLabel || q.length <= 40)) return true;
  return false;
}

/** Alias for channels — same as wantsProductPack. */
export function isProductIntent(text: string): boolean {
  return wantsProductPack(text);
}

function scoreProduct(product: DbProduct, query: string, requestedKw: number | null, hint: string | null): number {
  const blob = `${product.name} ${product.sku} ${product.category || ""} ${product.description || ""}`.toLowerCase();
  let score = 0;

  if (requestedKw != null) {
    const pKw = productPowerKw(product);
    if (pKw != null) {
      const diff = Math.abs(pKw - requestedKw);
      if (diff < 0.05) score += 100;
      else if (diff <= 0.25) score += 80;
      else if (diff <= 0.5) score += 50;
      else if (diff <= 1) score += 20;
      else score -= 40;
    } else {
      score -= 5;
    }
  }

  if (hint) {
    if (blob.includes(hint)) score += 35;
    else if (hint === "inverter" && /inverter|hybrid|solar|ongrid|offgrid|\bhf\b|\bpcu\b/.test(blob)) score += 20;
    else if (hint === "hf" && /\bhf\b|hybrid|high\s*freq|inverter|residential|home/.test(blob)) score += 40;
    else if (hint === "lf" && /\blf\b|low\s*freq/.test(blob)) score += 40;
    else if (hint === "ups" && /\bups\b/.test(blob)) score += 35;
    else if (hint === "hybrid" && /hybrid|hf|solar|inverter|\bpcu\b/.test(blob)) score += 30;
    else if (hint === "solar" && /solar|hybrid|ongrid|offgrid|\bpcu\b/.test(blob)) score += 25;
    else if (hint === "e-series" && /e[\s-]?series|eseries/.test(blob)) score += 40;
    else if (hint === "reefi" && /reefi/.test(blob)) score += 40;
  }

  const vdc = extractRequestedVdc(query);
  if (vdc != null) {
    if (blob.includes(String(vdc)) && /vdc|v\s*dc|\bdc\b/.test(blob)) score += 45;
    else if (blob.includes(String(vdc))) score += 15;
  }
  if (/\b(3\s*ph|three[\s-]?phase)\b/i.test(query) && /\b(3\s*ph|three[\s-]?phase|3ph)\b/i.test(blob)) {
    score += 20;
  }

  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !/^(the|and|for|with|price|cost|want|need|send|please|kitna|inverter|inverters)$/.test(t));

  for (const tok of tokens) {
    if (blob.includes(tok)) score += 8;
    if (product.sku.toLowerCase().includes(tok)) score += 15;
  }

  score += Math.round(Number(product.ai_weight || 0.5) * 10);
  if (product.image_url || product.image_path) score += 5;
  if (product.catalog_pdf_url || product.catalog_pdf_path) score += 5;
  if (product.price_label || product.price_paise) score += 5;

  return score;
}

export function rankProductsForQuery(products: DbProduct[], query: string): DbProduct[] {
  const requestedKw = extractRequestedKw(query);
  const hint = categoryHint(query);
  return [...products]
    .map((p) => ({ p, score: scoreProduct(p, query, requestedKw, hint) }))
    .filter((row) => {
      if (requestedKw != null) {
        const pKw = productPowerKw(row.p);
        if (pKw != null && Math.abs(pKw - requestedKw) > 1.51) return false;
        // Bare "3kw" — accept power match even with modest score
        if (pKw != null && Math.abs(pKw - requestedKw) <= 1.51) return row.score >= 20;
        // No power on row — keep if category/hint still scores
        return row.score >= 35;
      }
      return row.score >= 25;
    })
    .sort((a, b) => b.score - a.score)
    .map((row) => row.p);
}

function productCategoryKey(product: DbProduct): string {
  return String(product.category || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function matchesCategoryHint(product: DbProduct, hint: string): boolean {
  const blob = `${product.name} ${product.category || ""} ${product.description || ""} ${product.sku}`.toLowerCase();
  if (blob.includes(hint)) return true;
  if (hint === "hf") return /\bhf\b|high\s*freq|hybrid|inverter/.test(blob);
  if (hint === "lf") return /\blf\b|low\s*freq/.test(blob);
  if (hint === "inverter") return /inverter|hybrid|\bhf\b/.test(blob);
  if (hint === "hybrid") return /hybrid|inverter|\bhf\b|solar/.test(blob);
  if (hint === "ups") return /\bups\b/.test(blob);
  if (hint === "battery") return /batter|lithium|lead/.test(blob);
  if (hint === "solar") return /solar|ongrid|offgrid|hybrid/.test(blob);
  if (hint === "ongrid") return /ongrid|on[\s-]?grid|grid[\s-]?tie/.test(blob);
  if (hint === "offgrid") return /offgrid|off[\s-]?grid/.test(blob);
  if (hint === "bess") return /\bbess\b|battery\s*energy/.test(blob);
  if (hint === "e-series") return /e[\s-]?series|eseries/.test(blob);
  if (hint === "reefi") return /reefi/.test(blob);
  return false;
}

/**
 * Website / WhatsApp: all active products in the matched category (not only top kW hits).
 * Seed from ranked matches → expand by shared `category` (or broad type hint).
 */
export function productsForCarousel(products: DbProduct[], query: string): DbProduct[] {
  const hint = categoryHint(query);
  const requestedKw = extractRequestedKw(query);
  const ranked = rankProductsForQuery(products, query);

  const categories = new Set(
    ranked
      .slice(0, 8)
      .map((p) => productCategoryKey(p))
      .filter(Boolean),
  );

  let pool: DbProduct[] = [];

  if (categories.size > 0) {
    pool = products.filter((p) => categories.has(productCategoryKey(p)));
  } else if (hint) {
    pool = products.filter((p) => matchesCategoryHint(p, hint));
  } else if (ranked.length) {
    pool = ranked;
  }

  // Bare "3kw": prefer exact kW rows; if none, open HF/hybrid/inverter (typical residential)
  if (!pool.length && requestedKw != null) {
    pool = products.filter((p) => {
      const kw = productPowerKw(p);
      return kw != null && Math.abs(kw - requestedKw) <= 1.51;
    });
  }
  if (!pool.length && requestedKw != null) {
    pool = products.filter(
      (p) =>
        matchesCategoryHint(p, "hf") ||
        matchesCategoryHint(p, "hybrid") ||
        matchesCategoryHint(p, "inverter") ||
        matchesCategoryHint(p, "solar"),
    );
  }
  if (!pool.length && hint) {
    pool = products.filter((p) => matchesCategoryHint(p, hint));
  }
  if (!pool.length && ranked.length) pool = ranked;

  if (!pool.length) return [];

  return [...pool]
    .sort((a, b) => scoreProduct(b, query, requestedKw, hint) - scoreProduct(a, query, requestedKw, hint))
    .slice(0, 60);
}

/**
 * WhatsApp only: share the requested rating/model hits — NOT the full category dump.
 * e.g. "3kw" → only ~3 kW products (max 3), not every HF inverter.
 */
export function productsForWhatsApp(products: DbProduct[], query: string): DbProduct[] {
  const requestedKw = extractRequestedKw(query);
  const hint = categoryHint(query);
  const ranked = rankProductsForQuery(products, query);

  if (requestedKw != null) {
    const exact = products
      .map((p) => ({ p, score: scoreProduct(p, query, requestedKw, hint) }))
      .filter(({ p }) => {
        const kw = productPowerKw(p);
        if (kw == null) return false;
        return Math.abs(kw - requestedKw) <= 0.51;
      })
      .sort((a, b) => b.score - a.score)
      .map((row) => row.p);
    if (exact.length) return exact.slice(0, 3);
  }

  // No clear kW: tight ranked matches only (never productsForCarousel expand)
  return ranked.slice(0, 3);
}

function matchIntro(products: DbProduct[]): string {
  if (products.length === 1) {
    return formatProductPackBody(products[0]!);
  }
  const blocks = products.map((p, i) => `---\n${i + 1}. ${formatProductPackBody(p)}`);
  return `Here are the matching products:\n\n${blocks.join("\n\n")}`;
}

function clarifyMessage(products: DbProduct[]): string {
  const lines = products.slice(0, 8).map((p, i) => {
    const name = cleanProductDisplayName(p.name);
    const price = formatPrice(p);
    return `${i + 1}. ${name}${price ? ` — ${price}` : ""}`;
  });
  return `Which product do you want?\n${lines.join("\n")}\n\nReply with the number.`;
}

function carouselIntro(count: number, _categoryLabel?: string | null): string {
  if (count <= 1) return "Here is the requested product.";
  return "Here are the requested products.";
}

/**
 * Resolve product pack from active Products rows.
 * Pending numbered picks: reply "1" / "2" after clarify.
 * presentation "carousel" = website browse cards (no price until I need this).
 * presentation "whatsapp" = send up to 5 full packs (photo + caption + PDF).
 */
export async function resolveProductPackRequest(
  query: string,
  options?: {
    pendingProducts?: Array<{ id: string; name: string }>;
    presentation?: "detail" | "carousel" | "whatsapp";
  },
): Promise<ProductPackResult> {
  const q = String(query || "").trim();
  const presentation = options?.presentation || "detail";
  if (!q) return { mode: "none" };
  if (isAckOnlyMessage(q) || isGreetingOnlyMessage(q)) return { mode: "none" };
  if (isServiceIntent(q) && !/^\d{1,2}$/.test(q)) return { mode: "none" };

  const supabase = createServiceSupabase();
  const catLookup = await loadCategoryCatalogueLookup();

  // Follow-up pick after clarify / carousel list
  if (options?.pendingProducts?.length) {
    const num = q.match(/^(\d{1,2})$/);
    if (num) {
      const idx = Number(num[1]) - 1;
      const pick = options.pendingProducts[idx];
      if (pick) {
        const { data } = await supabase
          .from("products")
          .select("*")
          .eq("org_id", ORG_ID)
          .eq("id", pick.id)
          .eq("is_active", true)
          .maybeSingle();
        if (data) {
          const product = inheritCategoryCatalogue(data as DbProduct, catLookup);
          return { mode: "match", products: [product], message: formatProductPackBody(product) };
        }
      }
    }
    const lower = q.toLowerCase();
    const byName = options.pendingProducts.find(
      (p) => lower.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(lower),
    );
    if (byName) {
      const { data } = await supabase
        .from("products")
        .select("*")
        .eq("org_id", ORG_ID)
        .eq("id", byName.id)
        .eq("is_active", true)
        .maybeSingle();
      if (data) {
        const product = inheritCategoryCatalogue(data as DbProduct, catLookup);
        return { mode: "match", products: [product], message: formatProductPackBody(product) };
      }
    }
  }

  if (!wantsProductPack(q) && !options?.pendingProducts?.length) {
    return { mode: "none" };
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("org_id", ORG_ID)
    .eq("is_active", true)
    .order("ai_weight", { ascending: false })
    .limit(400);

  if (error) throw new Error(error.message);
  const products = withInheritedCatalogues((data || []) as DbProduct[], catLookup);
  if (!products.length) return { mode: "none" };

  // Website: all products in the matched category (swipe full range)
  if (presentation === "carousel") {
    const cards = productsForCarousel(products, q);
    if (!cards.length) return { mode: "none" };
    return {
      mode: "carousel",
      products: cards,
      message: carouselIntro(cards.length),
    };
  }

  // WhatsApp: only requested kW / tight matches (NOT full category) — max 3 packs
  if (presentation === "whatsapp") {
    const cards = productsForWhatsApp(products, q);
    if (!cards.length) return { mode: "none" };
    return {
      mode: "match",
      products: cards,
      message:
        cards.length === 1
          ? "Here is the matching product."
          : `Here are ${cards.length} matching products for your request.`,
    };
  }

  const ranked = rankProductsForQuery(products, q);
  if (!ranked.length) {
    // Detail fallback: still try broad category pool
    const broad = productsForCarousel(products, q);
    if (!broad.length) return { mode: "none" };
    const top = broad.slice(0, 3);
    return { mode: "match", products: top, message: matchIntro(top) };
  }

  if (ranked.length === 1) {
    return { mode: "match", products: ranked.slice(0, 1), message: matchIntro(ranked.slice(0, 1)) };
  }

  const top = ranked.slice(0, 6);
  const topScoreGap =
    scoreProduct(top[0]!, q, extractRequestedKw(q), categoryHint(q)) -
    scoreProduct(top[1]!, q, extractRequestedKw(q), categoryHint(q));

  if (topScoreGap >= 40) {
    return { mode: "match", products: top.slice(0, 1), message: matchIntro(top.slice(0, 1)) };
  }

  if (top.length <= 3 && extractRequestedKw(q) != null) {
    return { mode: "match", products: top, message: matchIntro(top) };
  }

  return { mode: "clarify", products: top, message: clarifyMessage(top) };
}

/** Load one active product by id (for I need this). */
export async function loadActiveProductById(productId: string): Promise<DbProduct | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("org_id", ORG_ID)
    .eq("id", productId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const catLookup = await loadCategoryCatalogueLookup();
  return inheritCategoryCatalogue(data as DbProduct, catLookup);
}

export type ProductPackMedia = {
  productId: string;
  productName: string;
  caption: string;
  body: string;
  imageUrl: string | null;
  catalogueUrl: string | null;
  catalogueFileName: string | null;
};

export function buildProductPackMedia(products: DbProduct[]): ProductPackMedia[] {
  return products.map((p) => {
    const catalogueUrl = resolveProductCatalogueUrl(p);
    const displayName = cleanProductDisplayName(p.name);
    const skuSafe = (p.sku || displayName).replace(/[^\w.-]+/g, "-");
    return {
      productId: p.id,
      productName: displayName,
      caption: formatProductRecommendationCaption(p),
      body: formatProductPackBody(p),
      imageUrl: resolveProductImageUrl(p),
      catalogueUrl,
      catalogueFileName: catalogueUrl ? `${skuSafe}-catalogue.pdf` : null,
    };
  });
}

function formatProductContextLine(p: DbProduct): string {
  const name = cleanProductDisplayName(p.name);
  const price = formatPrice(p);
  const features = cleanProductDescription(p.description || "", p.name).slice(0, 280);
  const catalog = resolveProductCatalogueUrl(p);
  return [
    `- ${name}`,
    price ? `  Price: ${price}` : null,
    features ? `  Features: ${features}` : null,
    catalog ? `  Catalogue: available` : null,
    p.image_url || p.image_path ? `  Photo: available` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Products catalogue text for OpenAI — always available alongside Knowledge Base.
 * Prefer query-ranked matches; otherwise top weighted active products.
 */
export async function buildProductsContextForAi(
  query: string,
  limit = 10,
  options?: { categories?: string[] },
): Promise<string> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("org_id", ORG_ID)
    .eq("is_active", true)
    .order("ai_weight", { ascending: false })
    .limit(80);

  if (error) {
    console.error("buildProductsContextForAi", error.message);
    return "";
  }
  const catLookup = await loadCategoryCatalogueLookup();
  let products = withInheritedCatalogues((data || []) as DbProduct[], catLookup);
  const want = (options?.categories || []).map((c) => normalizeCategoryKey(c)).filter(Boolean);
  if (want.length) {
    const scoped = products.filter((p) => want.includes(normalizeCategoryKey(p.category)));
    if (scoped.length) products = scoped;
  }
  if (!products.length) return "";

  const ranked = rankProductsForQuery(products, query);
  const list = (ranked.length ? ranked : products).slice(0, limit);
  const header = ranked.length
    ? "Products catalogue (matched — customer-facing fields ONLY: Name, Price, Features, Photo, Catalogue). Do not mention SKU, stock, category, or other metadata:"
    : "Products catalogue (active — share ONLY Name, Price, Features, Photo, Catalogue):";
  return `${header}\n${list.map(formatProductContextLine).join("\n")}`;
}
