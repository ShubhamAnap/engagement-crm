/**
 * Match Products catalogue rows to customer asks like "3kw inverter price".
 * Used by website chat + WhatsApp to send photo, price, description, catalogue PDF.
 */

import type { DbProduct } from "@/lib/db-types";
import { isAckOnlyMessage, isGreetingOnlyMessage } from "@/lib/enertech-scope";
import { isServiceIntent } from "@/lib/conversation-guards";
import { createServiceSupabase } from "@/lib/supabase";
import {
  formatProductPackBody,
  formatProductRecommendationCaption,
  resolveProductCatalogueUrl,
  resolveProductImageUrl,
  cleanProductDisplayName,
  cleanProductDescription,
} from "@/lib/product-card";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

const KW_RE = /(\d+(?:\.\d+)?)\s*(k\.?\s*w|k\.?\s*va|kw|kva)\b/i;
const PRODUCT_WORD_RE =
  /\b(inverters?|ups|hybrids?|batter(?:y|ies)|bess|ongrid|on[\s-]?grid|off[\s-]?grid|solar|e[\s-]?series|reefi|stabilizers?|chargers?|sfc|products?|models?)\b/i;
const DETAIL_RE =
  /\b(price|pricing|cost|rate|quote|quotation|kitna|kitne|rs\.?|₹|inr|details?|specs?|specification|send|bhejo|dikhao|info|information|available|stock)\b/i;
const PRICE_RE = /\b(price|pricing|cost|rate|quote|quotation|kitna|kitne|rs\.?|₹|inr)\b/i;

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

function categoryHint(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bhybrids?\b/.test(t)) return "hybrid";
  if (/\bongrid|on[\s-]?grid\b/.test(t)) return "ongrid";
  if (/\boff[\s-]?grid\b/.test(t)) return "offgrid";
  if (/\bbess\b/.test(t)) return "bess";
  if (/\bbatter(?:y|ies)\b/.test(t)) return "battery";
  if (/\bups\b/.test(t)) return "ups";
  if (/\binverters?\b/.test(t)) return "inverter";
  if (/\bsolar\b/.test(t)) return "solar";
  return null;
}

/** True when customer is asking for a product / price pack from the Products list. */
export function wantsProductPack(text: string): boolean {
  const q = String(text || "").trim();
  if (!q || q.length > 280) return false;
  if (isAckOnlyMessage(q) || isGreetingOnlyMessage(q)) return false;
  if (isServiceIntent(q)) return false;

  const hasKw = KW_RE.test(q);
  const hasProduct = PRODUCT_WORD_RE.test(q);
  const priceAsk = PRICE_RE.test(q);
  const wantsDetail = DETAIL_RE.test(q);

  // "3kw inverter price", "5 kw hybrid", bare "3kw" / "inverter"
  if (hasKw && (hasProduct || priceAsk || wantsDetail)) return true;
  if (hasKw && q.length <= 48) return true;
  if (hasProduct && q.length <= 64) return true;
  if (hasProduct && priceAsk) return true;
  return false;
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
    else if (hint === "inverter" && /inverter|hybrid|solar|ongrid|offgrid/.test(blob)) score += 20;
    else if (hint === "ups" && /\bups\b/.test(blob)) score += 35;
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
        // Keep near matches; if no power on product, still allow name hits
        if (pKw != null && Math.abs(pKw - requestedKw) > 1.01) return false;
        return row.score >= 40;
      }
      return row.score >= 30;
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
  if (hint === "inverter") return /inverter|hybrid|\bhf\b/.test(blob);
  if (hint === "hybrid") return /hybrid|inverter/.test(blob);
  if (hint === "ups") return /\bups\b/.test(blob);
  if (hint === "battery") return /batter|lithium|lead/.test(blob);
  if (hint === "solar") return /solar|ongrid|offgrid|hybrid/.test(blob);
  if (hint === "ongrid") return /ongrid|on[\s-]?grid|grid[\s-]?tie/.test(blob);
  if (hint === "offgrid") return /offgrid|off[\s-]?grid/.test(blob);
  if (hint === "bess") return /\bbess\b|battery\s*energy/.test(blob);
  return false;
}

/**
 * Website carousel: all active products in the matched category (not only top kW hits).
 * Seed from ranked matches → expand by shared `category` (or type hint).
 */
export function productsForCarousel(products: DbProduct[], query: string): DbProduct[] {
  const hint = categoryHint(query);
  const ranked = rankProductsForQuery(products, query);
  const requestedKw = extractRequestedKw(query);

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
  } else if (hint) {
    pool = products.filter((p) => matchesCategoryHint(p, hint));
  }

  // If kW ask found seeds but category expand empty, fall back to ranked
  if (!pool.length && ranked.length) pool = ranked;

  // Still nothing — try hint alone (e.g. "inverter" with weak scores)
  if (!pool.length && hint) {
    pool = products.filter((p) => matchesCategoryHint(p, hint));
  }

  if (!pool.length) return [];

  return [...pool]
    .sort((a, b) => scoreProduct(b, query, requestedKw, hint) - scoreProduct(a, query, requestedKw, hint))
    .slice(0, 60);
}

function clarifyMessage(products: DbProduct[]): string {
  const lines = products.slice(0, 8).map((p, i) => {
    const name = cleanProductDisplayName(p.name);
    const price = p.price_label
      ? ` — ${/^[₹rs]/i.test(p.price_label) ? p.price_label : `₹${p.price_label}`}`
      : p.price_paise != null
        ? ` — ₹${(p.price_paise / 100).toLocaleString("en-IN")}`
        : "";
    return `${i + 1}. ${name}${price}`;
  });
  return `Which product do you want?\n${lines.join("\n")}\n\nReply with the number.`;
}

function carouselIntro(count: number, categoryLabel?: string | null): string {
  if (count <= 1) return "Here’s a matching product — tap I need this for price, features, and catalogue.";
  if (categoryLabel) {
    return `Here are all ${count} products in ${categoryLabel} — swipe left or right, then tap I need this.`;
  }
  return `Here are ${count} matching products — swipe left or right, then tap I need this.`;
}

/**
 * Resolve product pack from active Products rows.
 * Pending numbered picks: reply "1" / "2" after clarify.
 * presentation "carousel" = website browse cards (no price until I need this).
 */
export async function resolveProductPackRequest(
  query: string,
  options?: {
    pendingProducts?: Array<{ id: string; name: string }>;
    presentation?: "detail" | "carousel";
  },
): Promise<ProductPackResult> {
  const q = String(query || "").trim();
  const presentation = options?.presentation || "detail";
  if (!q) return { mode: "none" };
  if (isAckOnlyMessage(q) || isGreetingOnlyMessage(q)) return { mode: "none" };
  if (isServiceIntent(q) && !/^\d{1,2}$/.test(q)) return { mode: "none" };

  const supabase = createServiceSupabase();

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
          const product = data as DbProduct;
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
        const product = data as DbProduct;
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
    .limit(200);

  if (error) throw new Error(error.message);
  const products = (data || []) as DbProduct[];
  if (!products.length) return { mode: "none" };

  // Website: all products in the matched category (swipe full range)
  if (presentation === "carousel") {
    const cards = productsForCarousel(products, q);
    if (!cards.length) return { mode: "none" };
    const cat =
      cards.find((p) => p.category?.trim())?.category?.trim() ||
      (categoryHint(q) ? categoryHint(q)!.replace(/^\w/, (c) => c.toUpperCase()) : null);
    return {
      mode: "carousel",
      products: cards,
      message: carouselIntro(cards.length, cat),
    };
  }

  const ranked = rankProductsForQuery(products, q);
  if (!ranked.length) return { mode: "none" };

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
  return (data as DbProduct) || null;
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
  const price = p.price_label
    ? /^[₹rs]/i.test(p.price_label) ? p.price_label : `₹${p.price_label}`
    : p.price_paise != null
      ? `₹${(p.price_paise / 100).toLocaleString("en-IN")}`
      : null;
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
export async function buildProductsContextForAi(query: string, limit = 10): Promise<string> {
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
  const products = (data || []) as DbProduct[];
  if (!products.length) return "";

  const ranked = rankProductsForQuery(products, query);
  const list = (ranked.length ? ranked : products).slice(0, limit);
  const header = ranked.length
    ? "Products catalogue (matched — customer-facing fields ONLY: Name, Price, Features, Photo, Catalogue). Do not mention SKU, stock, category, or other metadata:"
    : "Products catalogue (active — share ONLY Name, Price, Features, Photo, Catalogue):";
  return `${header}\n${list.map(formatProductContextLine).join("\n")}`;
}
