/**
 * WordPress / WooCommerce catalog connector — pull-only.
 * WP is source of truth. Images/PDFs stay on WP as public HTTPS URLs
 * (not re-uploaded unless Meta later cannot fetch them).
 *
 * Inspect works without REST keys via Woo Store API.
 * Full price / description / download PDFs need Woo REST v3 consumer key + secret.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import type { DbProduct, StockStatus } from "@/lib/db-types";

import { DEFAULT_ORG_ID } from "@/server/org-context";
export const WORDPRESS_DEFAULT_SITE = "https://enertechups.com";
const MAX_PRODUCTS = 500;
const FETCH_TIMEOUT_MS = 25_000;
const PER_PAGE = 100;

export type WordpressChannelConfig = {
  site_url: string;
  consumer_key: string;
  consumer_secret: string;
  last_sync_at?: string | null;
  last_sync_result?: string | null;
  last_sync_error?: string | null;
  product_count?: number;
};

export type WordpressInspectSample = {
  id: number;
  name: string;
  sku: string;
  mappedSku: string;
  priceLabel: string | null;
  imageUrl: string | null;
  catalogueUrl: string | null;
  category: string | null;
};

export type WordpressInspectResult = {
  siteUrl: string;
  storeApiOk: boolean;
  restV3Ok: boolean;
  restV3Status: number | null;
  wpV2Ok: boolean;
  hasKeys: boolean;
  estimatedTotal: number | null;
  skuEmpty: number;
  withImage: number;
  withPdf: number;
  withPrice: number;
  sample: WordpressInspectSample[];
  pdfHint: string;
  hint: string;
};

type MappedWooProduct = {
  wordpressId: number;
  sku: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  pricePaise: number | null;
  priceLabel: string | null;
  mrpPaise: number | null;
  mrpLabel: string | null;
  stockStatus: StockStatus;
  quantity: number;
  imageUrl: string | null;
  catalogueUrl: string | null;
  permalink: string | null;
  isActive: boolean;
};

type ParsedPrices = {
  paise: number | null;
  label: string | null;
  mrpPaise: number | null;
  mrpLabel: string | null;
};

const EMPTY_PRICES: ParsedPrices = {
  paise: null,
  label: null,
  mrpPaise: null,
  mrpLabel: null,
};

function envTrim(name: string): string {
  return String(process.env[name] || "").trim();
}

function normalizeSiteUrl(raw: string): string {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  if (!s) return WORDPRESS_DEFAULT_SITE;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(str(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function stripHtml(html: string): string {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => {
      const code = Number(d);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function toHttpsUrl(raw: unknown): string | null {
  const s = str(raw).trim();
  if (!s) return null;
  if (s.startsWith("//")) return `https:${s}`;
  if (/^https:\/\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) return `https://${s.slice("http://".length)}`;
  return null;
}

function extractPdfUrls(text: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const https = toHttpsUrl(m[0]);
    if (https) out.push(https);
  }
  return out;
}

function looksLikePdf(value: unknown): string | null {
  if (typeof value === "string") {
    const https = toHttpsUrl(value);
    if (https && /\.pdf(\?|$)/i.test(https)) return https;
    const fromText = extractPdfUrls(value)[0];
    return fromText || null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = looksLikePdf(item);
      if (found) return found;
    }
    return null;
  }
  const rec = asRecord(value);
  return (
    looksLikePdf(rec.file) ||
    looksLikePdf(rec.url) ||
    looksLikePdf(rec.src) ||
    looksLikePdf(rec.value) ||
    null
  );
}

function mappedSku(sku: string, slug: string, id: number): string {
  const s = sku.trim();
  if (s) return s.slice(0, 80);
  const sl = slug.trim();
  if (sl) return sl.slice(0, 80);
  return `WOO-${id}`;
}

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function fromMinorUnits(raw: string, minor: number): { paise: number; label: string } | null {
  const n = num(raw);
  if (n == null || n <= 0) return null;
  const rupees = n / 10 ** minor;
  if (!Number.isFinite(rupees) || rupees <= 0) return null;
  return { paise: Math.round(rupees * 100), label: formatInr(rupees) };
}

function fromRupees(raw: string): { paise: number; label: string } | null {
  const n = num(raw);
  if (n == null || n <= 0) return null;
  return { paise: Math.round(n * 100), label: formatInr(n) };
}

function parseStorePrice(prices: Record<string, unknown> | null, onSale: boolean): ParsedPrices {
  if (!prices) return EMPTY_PRICES;
  const minor = Math.max(0, Math.min(4, num(prices.currency_minor_unit) ?? 2));
  const sale = fromMinorUnits(str(prices.sale_price), minor);
  const regular = fromMinorUnits(str(prices.regular_price), minor);
  const current = fromMinorUnits(str(prices.price), minor);
  const selling = onSale && sale ? sale : current || sale || regular;
  const mrp = regular || current;
  return {
    paise: selling?.paise ?? null,
    label: selling?.label ?? null,
    mrpPaise: mrp?.paise ?? null,
    mrpLabel: mrp?.label ?? null,
  };
}

function parseRestPrice(product: Record<string, unknown>): ParsedPrices {
  const sale = fromRupees(str(product.sale_price).trim());
  const regular = fromRupees(str(product.regular_price).trim());
  const current = fromRupees(str(product.price).trim());
  const selling = sale || current || regular;
  const mrp = regular || (!sale ? current : null);
  return {
    paise: selling?.paise ?? null,
    label: selling?.label ?? null,
    mrpPaise: mrp?.paise ?? null,
    mrpLabel: mrp?.label ?? null,
  };
}

function mapStock(opts: {
  stockStatus?: string;
  inStock?: boolean;
  onBackorder?: boolean;
  quantity?: number | null;
}): StockStatus {
  const st = str(opts.stockStatus).toLowerCase();
  if (st === "outofstock" || opts.inStock === false) return "Out of Stock";
  if (st === "onbackorder" || opts.onBackorder) return "Made to Order";
  if (typeof opts.quantity === "number" && opts.quantity > 0 && opts.quantity <= 3) return "Low Stock";
  return "In Stock";
}

function firstCategory(raw: unknown): string | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const names = raw
    .map((c) => str(asRecord(c).name).trim())
    .filter(Boolean);
  return names[0] || null;
}

function firstImage(raw: unknown): string | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  for (const img of raw) {
    const rec = asRecord(img);
    const url = toHttpsUrl(rec.src || rec.url || rec.thumbnail);
    if (url) return url;
  }
  return null;
}

function catalogueFromRest(product: Record<string, unknown>): string | null {
  const downloads = Array.isArray(product.downloads) ? product.downloads : [];
  for (const d of downloads) {
    const found = looksLikePdf(d);
    if (found) return found;
  }
  const meta = Array.isArray(product.meta_data) ? product.meta_data : [];
  for (const row of meta) {
    const rec = asRecord(row);
    const key = str(rec.key).toLowerCase();
    if (!/(catalog|catalogue|pdf|datasheet|brochure|download)/i.test(key)) continue;
    const found = looksLikePdf(rec.value);
    if (found) return found;
  }
  const html = `${str(product.description)}\n${str(product.short_description)}`;
  return extractPdfUrls(html)[0] || looksLikePdf(html);
}

/** Theme plugins (e.g. Wishlist) often print HTML before REST JSON. */
function parseWpJson(text: string): unknown {
  const trimmed = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* continue */
  }
  const startArr = trimmed.indexOf("[");
  const startObj = trimmed.indexOf("{");
  let start = -1;
  if (startArr >= 0 && (startObj < 0 || startArr < startObj)) start = startArr;
  else if (startObj >= 0) start = startObj;
  if (start < 0) return null;
  const slice = trimmed.slice(start);
  try {
    return JSON.parse(slice);
  } catch {
    /* continue */
  }
  const end = Math.max(slice.lastIndexOf("]"), slice.lastIndexOf("}"));
  if (end > 0) {
    try {
      return JSON.parse(slice.slice(0, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function productRowsFromJson(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  const rec = asRecord(json);
  if (Array.isArray(rec.products)) return rec.products;
  if (Array.isArray(rec.data)) return rec.data;
  return [];
}

function wooErrorMessage(json: unknown): string | null {
  const rec = asRecord(json);
  const msg = str(rec.message).trim();
  const code = str(rec.code).trim();
  if (msg && code) return `${code}: ${msg}`;
  return msg || code || null;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{
  ok: boolean;
  status: number;
  json: unknown;
  header: (name: string) => string | null;
}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "EngageCRM/1.0 (catalog-sync)",
        ...(init?.headers || {}),
      },
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      json: parseWpJson(text),
      header: (name) => res.headers.get(name),
    };
  } catch {
    return { ok: false, status: 0, json: null, header: () => null };
  } finally {
    clearTimeout(timer);
  }
}

function wooAuthHeader(key: string, secret: string): Record<string, string> {
  const token = Buffer.from(`${key}:${secret}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

export async function loadWordpressConfig(): Promise<WordpressChannelConfig> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("channels")
    .select("config")
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("type", "wordpress")
    .maybeSingle();
  if (error && /invalid input value for enum|wordpress/i.test(error.message)) {
    console.warn("wordpress channel enum missing:", error.message);
  }
  const cfg = asRecord(data?.config);
  const site =
    str(cfg.site_url) ||
    envTrim("WOO_SITE_URL") ||
    envTrim("WORDPRESS_SITE_URL") ||
    envTrim("WOOCOMMERCE_URL") ||
    WORDPRESS_DEFAULT_SITE;
  return {
    site_url: normalizeSiteUrl(site),
    consumer_key:
      str(cfg.consumer_key) || envTrim("WOO_CONSUMER_KEY") || envTrim("WOOCOMMERCE_CONSUMER_KEY"),
    consumer_secret:
      str(cfg.consumer_secret) ||
      envTrim("WOO_CONSUMER_SECRET") ||
      envTrim("WOOCOMMERCE_CONSUMER_SECRET"),
    last_sync_at: str(cfg.last_sync_at) || null,
    last_sync_result: str(cfg.last_sync_result) || null,
    last_sync_error: str(cfg.last_sync_error) || null,
    product_count: num(cfg.product_count) ?? undefined,
  };
}

function hasKeys(cfg: WordpressChannelConfig): boolean {
  return Boolean(cfg.consumer_key && cfg.consumer_secret);
}

function mapRestProduct(raw: Record<string, unknown>): MappedWooProduct | null {
  const id = num(raw.id);
  if (id == null) return null;
  const status = str(raw.status).toLowerCase();
  if (status && status !== "publish") return null;
  const sku = str(raw.sku);
  const slug = str(raw.slug);
  const name = stripHtml(str(raw.name) || slug || `Product ${id}`);
  if (!name) return null;
  const desc =
    stripHtml(str(raw.short_description)) || stripHtml(str(raw.description)) || null;
  const price = parseRestPrice(raw);
  const qty = num(raw.stock_quantity);
  return {
    wordpressId: id,
    sku: mappedSku(sku, slug, id),
    slug,
    name: name.slice(0, 200),
    category: firstCategory(raw.categories),
    description: desc ? desc.slice(0, 2000) : null,
    pricePaise: price.paise,
    priceLabel: price.label,
    mrpPaise: price.mrpPaise,
    mrpLabel: price.mrpLabel,
    stockStatus: mapStock({
      stockStatus: str(raw.stock_status),
      quantity: qty,
    }),
    quantity: qty && qty > 0 ? Math.floor(qty) : 0,
    imageUrl: firstImage(raw.images),
    catalogueUrl: catalogueFromRest(raw),
    permalink: toHttpsUrl(raw.permalink),
    isActive: true,
  };
}

function mapStoreProduct(raw: Record<string, unknown>): MappedWooProduct | null {
  const id = num(raw.id);
  if (id == null) return null;
  const sku = str(raw.sku);
  const slug = str(raw.slug);
  const name = stripHtml(str(raw.name) || slug || `Product ${id}`);
  if (!name) return null;
  const desc =
    stripHtml(str(raw.short_description)) || stripHtml(str(raw.description)) || null;
  const prices = asRecord(raw.prices);
  const price = parseStorePrice(prices, Boolean(raw.on_sale));
  const inStock = raw.is_in_stock !== false;
  return {
    wordpressId: id,
    sku: mappedSku(sku, slug, id),
    slug,
    name: name.slice(0, 200),
    category: firstCategory(raw.categories),
    description: desc ? desc.slice(0, 2000) : null,
    pricePaise: price.paise,
    priceLabel: price.label,
    mrpPaise: price.mrpPaise,
    mrpLabel: price.mrpLabel,
    stockStatus: mapStock({
      inStock,
      onBackorder: Boolean(raw.is_on_backorder),
    }),
    quantity: inStock ? 1 : 0,
    imageUrl: firstImage(raw.images),
    catalogueUrl: extractPdfUrls(`${str(raw.description)}\n${str(raw.short_description)}`)[0] || null,
    permalink: toHttpsUrl(raw.permalink),
    isActive: true,
  };
}

async function fetchRestV3Page(
  cfg: WordpressChannelConfig,
  page: number,
  withStatus: boolean,
  auth: "query" | "basic",
): Promise<{ ok: boolean; status: number; json: unknown; header: (name: string) => string | null }> {
  const url = new URL(`${cfg.site_url}/wp-json/wc/v3/products`);
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("page", String(page));
  if (withStatus) url.searchParams.set("status", "publish");
  const headers: Record<string, string> =
    auth === "basic" ? wooAuthHeader(cfg.consumer_key, cfg.consumer_secret) : {};
  if (auth === "query") {
    url.searchParams.set("consumer_key", cfg.consumer_key);
    url.searchParams.set("consumer_secret", cfg.consumer_secret);
  }
  return fetchJson(url.toString(), Object.keys(headers).length ? { headers } : undefined);
}

async function fetchRestV3Products(cfg: WordpressChannelConfig): Promise<{
  products: MappedWooProduct[];
  total: number | null;
  status: number;
  error: string | null;
}> {
  if (!hasKeys(cfg)) return { products: [], total: null, status: 0, error: null };
  const products: MappedWooProduct[] = [];
  let total: number | null = null;
  let status = 0;
  let error: string | null = null;
  let auth: "query" | "basic" = "query";
  let withStatus = true;

  for (let page = 1; page <= Math.ceil(MAX_PRODUCTS / PER_PAGE); page++) {
    let res = await fetchRestV3Page(cfg, page, withStatus, auth);
    status = res.status;

    if (page === 1 && (res.status === 401 || res.status === 403) && auth === "query") {
      auth = "basic";
      res = await fetchRestV3Page(cfg, page, withStatus, auth);
      status = res.status;
    }

    if (!res.ok) {
      error = wooErrorMessage(res.json) || `Woo REST v3 HTTP ${res.status}`;
      if (page === 1) return { products: [], total: null, status, error };
      break;
    }

    let rows = productRowsFromJson(res.json);
    if (page === 1 && withStatus && rows.length === 0) {
      withStatus = false;
      res = await fetchRestV3Page(cfg, page, withStatus, auth);
      status = res.status;
      if (!res.ok) {
        error = wooErrorMessage(res.json) || `Woo REST v3 HTTP ${res.status}`;
        return { products: [], total: null, status, error };
      }
      rows = productRowsFromJson(res.json);
    }

    if (total == null) {
      const headerTotal = Number(res.header("X-WP-Total") || res.header("x-wp-total") || "");
      if (Number.isFinite(headerTotal)) total = headerTotal;
    }
    if (!rows.length) break;
    for (const row of rows) {
      const mapped = mapRestProduct(asRecord(row));
      if (mapped) products.push(mapped);
      if (products.length >= MAX_PRODUCTS) break;
    }
    if (rows.length < PER_PAGE || products.length >= MAX_PRODUCTS) break;
  }
  return { products, total: total ?? products.length, status, error };
}

async function fetchStoreProducts(cfg: WordpressChannelConfig): Promise<{
  products: MappedWooProduct[];
  total: number | null;
  ok: boolean;
  status: number;
}> {
  const products: MappedWooProduct[] = [];
  let total: number | null = null;
  let status = 0;
  let ok = false;
  for (let page = 1; page <= Math.ceil(MAX_PRODUCTS / PER_PAGE); page++) {
    const url = `${cfg.site_url}/wp-json/wc/store/v1/products?per_page=${PER_PAGE}&page=${page}`;
    const res = await fetchJson(url);
    status = res.status;
    if (!res.ok) {
      if (page === 1) return { products: [], total: null, ok: false, status };
      break;
    }
    ok = true;
    if (total == null) {
      const headerTotal = Number(res.header("X-WP-Total") || res.header("x-wp-total") || "");
      if (Number.isFinite(headerTotal)) total = headerTotal;
    }
    const rows = productRowsFromJson(res.json);
    if (!rows.length) break;
    for (const row of rows) {
      const mapped = mapStoreProduct(asRecord(row));
      if (mapped) products.push(mapped);
      if (products.length >= MAX_PRODUCTS) break;
    }
    if (rows.length < PER_PAGE || products.length >= MAX_PRODUCTS) break;
  }
  return { products, total: total ?? products.length, ok, status };
}

async function fetchPdfMediaIndex(siteUrl: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  for (let page = 1; page <= 10; page++) {
    const url = `${siteUrl}/wp-json/wp/v2/media?mime_type=application/pdf&per_page=100&page=${page}`;
    const res = await fetchJson(url);
    if (!res.ok) break;
    const rows = productRowsFromJson(res.json);
    if (!rows.length) break;
    for (const row of rows) {
      const rec = asRecord(row);
      const parent = num(rec.post) ?? num(rec.parent);
      const file = toHttpsUrl(rec.source_url) || looksLikePdf(rec.source_url);
      if (parent != null && file) map.set(parent, file);
    }
    if (rows.length < 100) break;
  }
  return map;
}

async function stampSync(patch: {
  last_sync_at?: string | null;
  last_sync_result?: string | null;
  last_sync_error?: string | null;
  product_count?: number;
  status?: string;
  health?: number;
  is_enabled?: boolean;
  detail?: string;
}) {
  const supabase = createServiceSupabase();
  const prev = await loadWordpressConfig();
  const config: WordpressChannelConfig = {
    ...prev,
    last_sync_at: patch.last_sync_at !== undefined ? patch.last_sync_at : prev.last_sync_at,
    last_sync_result:
      patch.last_sync_result !== undefined ? patch.last_sync_result : prev.last_sync_result,
    last_sync_error:
      patch.last_sync_error !== undefined ? patch.last_sync_error : prev.last_sync_error,
    product_count: patch.product_count ?? prev.product_count,
  };
  await supabase
    .from("channels")
    .update({
      config,
      detail: patch.detail ?? config.last_sync_result ?? "WordPress catalog pull",
      status: patch.status ?? undefined,
      health: patch.health ?? undefined,
      is_enabled: patch.is_enabled ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("type", "wordpress");
}

function mergeKeep(
  existing: {
    sku: string;
    category?: string | null;
    description?: string | null;
    price_paise?: number | null;
    price_label?: string | null;
    mrp_paise?: number | null;
    mrp_label?: string | null;
    image_url?: string | null;
    catalog_pdf_url?: string | null;
    specs?: Record<string, unknown> | null;
  },
  incoming: MappedWooProduct,
): Record<string, unknown> {
  const specs = {
    ...(existing.specs && typeof existing.specs === "object" ? existing.specs : {}),
    wordpress_id: incoming.wordpressId,
    wordpress_slug: incoming.slug,
    wordpress_permalink: incoming.permalink,
    source: "wordpress",
  };
  return {
    sku: incoming.sku,
    name: incoming.name,
    category: incoming.category || existing.category,
    description: incoming.description || existing.description,
    stock_status: incoming.stockStatus,
    quantity: incoming.quantity,
    price_paise: incoming.pricePaise ?? existing.price_paise,
    price_label: incoming.priceLabel || existing.price_label,
    mrp_paise: incoming.mrpPaise ?? existing.mrp_paise,
    mrp_label: incoming.mrpLabel || existing.mrp_label,
    image_url: incoming.imageUrl || existing.image_url,
    catalog_pdf_url: incoming.catalogueUrl || existing.catalog_pdf_url,
    is_active: incoming.isActive,
    specs,
    updated_at: new Date().toISOString(),
  };
}

async function upsertProducts(mapped: MappedWooProduct[]): Promise<{
  created: number;
  updated: number;
  deactivated: number;
  errors: string[];
}> {
  const supabase = createServiceSupabase();
  const { data: existingRows, error: listErr } = await supabase
    .from("products")
    .select("*")
    .eq("org_id", DEFAULT_ORG_ID)
    .limit(1000);
  if (listErr) throw new Error(listErr.message);

  const existing = (existingRows || []) as DbProduct[];
  type RowLite = Pick<DbProduct, "id" | "sku" | "is_active"> & { specs: Record<string, unknown> };
  const byWpId = new Map<number, RowLite>();
  const bySku = new Map<string, RowLite>();
  for (const row of existing) {
    const specs = asRecord(row.specs);
    const wid = num(specs.wordpress_id);
    if (wid != null) byWpId.set(wid, row);
    if (row.sku) bySku.set(row.sku.toLowerCase(), row);
  }

  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  const seenWp = new Set<number>();

  for (const item of mapped) {
    seenWp.add(item.wordpressId);
    const match = byWpId.get(item.wordpressId) || bySku.get(item.sku.toLowerCase());
    try {
      if (match) {
        const payload = mergeKeep(match, item);
        const nextSku = String(payload.sku || match.sku);
        const skuOwner = bySku.get(nextSku.toLowerCase());
        if (nextSku !== match.sku && skuOwner && skuOwner.id !== match.id) {
          payload.sku = match.sku;
        }
        let { error } = await supabase.from("products").update(payload).eq("id", match.id);
        if (error && /mrp_label|mrp_paise/i.test(error.message)) {
          console.warn("product mrp columns missing — run 036_product_mrp.sql");
          const { mrp_paise: _mrpPaise, mrp_label: _mrpLabel, ...rest } = payload;
          ({ error } = await supabase.from("products").update(rest).eq("id", match.id));
        }
        if (error) throw error;
        updated += 1;
        const nextRow: RowLite = {
          id: match.id,
          sku: String(payload.sku || match.sku),
          is_active: true,
          specs: (payload.specs as Record<string, unknown>) || match.specs,
        };
        byWpId.set(item.wordpressId, nextRow);
        bySku.set(nextRow.sku.toLowerCase(), nextRow);
      } else {
        const insertRow = {
            org_id: DEFAULT_ORG_ID,
            sku: item.sku,
            name: item.name,
            category: item.category,
            description: item.description,
            stock_status: item.stockStatus,
            quantity: item.quantity,
            price_paise: item.pricePaise,
            price_label: item.priceLabel,
            mrp_paise: item.mrpPaise,
            mrp_label: item.mrpLabel,
            ai_weight: 0.5,
            specs: {
              wordpress_id: item.wordpressId,
              wordpress_slug: item.slug,
              wordpress_permalink: item.permalink,
              source: "wordpress",
            },
            is_active: true,
            image_url: item.imageUrl,
            catalog_pdf_url: item.catalogueUrl,
          };
        let { data, error } = await supabase.from("products").insert(insertRow).select("id").single();
        if (error && /mrp_label|mrp_paise/i.test(error.message)) {
          console.warn("product mrp columns missing — run 036_product_mrp.sql");
          const { mrp_paise: _mrpPaise, mrp_label: _mrpLabel, ...rest } = insertRow;
          ({ data, error } = await supabase.from("products").insert(rest).select("id").single());
        }
        if (error) throw error;
        created += 1;
        if (data?.id) {
          const stub: RowLite = {
            id: data.id as string,
            sku: item.sku,
            is_active: true,
            specs: { wordpress_id: item.wordpressId },
          };
          byWpId.set(item.wordpressId, stub);
          bySku.set(item.sku.toLowerCase(), stub);
        }
      }
    } catch (err) {
      errors.push(`${item.sku}: ${err instanceof Error ? err.message : String(err)}`);
      if (errors.length >= 12) break;
    }
  }

  let deactivated = 0;
  for (const row of existing) {
    const wid = num(asRecord(row.specs).wordpress_id);
    if (wid == null || seenWp.has(wid)) continue;
    if (row.is_active === false) continue;
    const { error } = await supabase.from("products").update({ is_active: false }).eq("id", row.id);
    if (!error) deactivated += 1;
  }

  return { created, updated, deactivated, errors };
}

export const getWordpressSetup = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = createServiceSupabase();
  const cfg = await loadWordpressConfig();
  const { data: channel, error } = await supabase
    .from("channels")
    .select("id, is_enabled, status")
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("type", "wordpress")
    .maybeSingle();
  if (error && /invalid input value for enum|wordpress/i.test(error.message)) {
    return {
      configured: false,
      hasKeys: false,
      channelReady: false,
      channelCreated: false,
      siteUrl: cfg.site_url || WORDPRESS_DEFAULT_SITE,
      lastSyncAt: null,
      lastSyncResult: null,
      lastSyncError:
        "Run migration 034_wordpress_channel.sql then 034b_wordpress_channel_row.sql in Supabase.",
      productCount: null,
      fromEnv: {
        siteUrl: Boolean(envTrim("WOO_SITE_URL") || envTrim("WORDPRESS_SITE_URL") || envTrim("WOOCOMMERCE_URL")),
        key: Boolean(envTrim("WOO_CONSUMER_KEY") || envTrim("WOOCOMMERCE_CONSUMER_KEY")),
        secret: Boolean(envTrim("WOO_CONSUMER_SECRET") || envTrim("WOOCOMMERCE_CONSUMER_SECRET")),
      },
    };
  }
  return {
    configured: Boolean(cfg.site_url),
    hasKeys: hasKeys(cfg),
    channelReady: Boolean(channel),
    channelCreated: Boolean(channel),
    siteUrl: cfg.site_url || WORDPRESS_DEFAULT_SITE,
    lastSyncAt: cfg.last_sync_at || null,
    lastSyncResult: cfg.last_sync_result || null,
    lastSyncError: cfg.last_sync_error || null,
    productCount: cfg.product_count ?? null,
    fromEnv: {
      siteUrl: Boolean(envTrim("WOO_SITE_URL") || envTrim("WORDPRESS_SITE_URL") || envTrim("WOOCOMMERCE_URL")),
      key: Boolean(envTrim("WOO_CONSUMER_KEY") || envTrim("WOOCOMMERCE_CONSUMER_KEY")),
      secret: Boolean(envTrim("WOO_CONSUMER_SECRET") || envTrim("WOOCOMMERCE_CONSUMER_SECRET")),
    },
  };
});

async function ensureWordpressChannelRow(): Promise<{
  ok: boolean;
  created: boolean;
  error: string | null;
}> {
  const supabase = createServiceSupabase();
  const { data: existing } = await supabase
    .from("channels")
    .select("id")
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("type", "wordpress")
    .maybeSingle();
  if (existing) return { ok: true, created: false, error: null };

  const { error } = await supabase.from("channels").insert({
    org_id: DEFAULT_ORG_ID,
    type: "wordpress",
    name: "WordPress / WooCommerce",
    status: "Disconnected",
    health: 0,
    detail: "Product catalog pull (WordPress is source of truth)",
    is_enabled: false,
    config: { site_url: WORDPRESS_DEFAULT_SITE },
  });
  if (error) {
    if (/invalid input value for enum|wordpress/i.test(error.message)) {
      return {
        ok: false,
        created: false,
        error:
          "Run migration 034_wordpress_channel.sql (Step 1), then 034b_wordpress_channel_row.sql in Supabase.",
      };
    }
    return { ok: false, created: false, error: error.message };
  }
  return { ok: true, created: true, error: null };
}

export const ensureWordpressChannel = createServerFn({ method: "POST" }).handler(async () => {
  return ensureWordpressChannelRow();
});

export const saveWordpressChannelConfig = createServerFn({ method: "POST" })
  .validator(
    z.object({
      siteUrl: z.string().min(4).max(400),
      consumerKey: z.string().max(200).optional(),
      consumerSecret: z.string().max(200).optional(),
      enable: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const ensured = await ensureWordpressChannelRow();
    if (!ensured.ok) throw new Error(ensured.error || "WordPress channel is missing.");
    const prev = await loadWordpressConfig();
    const config: WordpressChannelConfig = {
      ...prev,
      site_url: normalizeSiteUrl(data.siteUrl),
      consumer_key: data.consumerKey?.trim() || prev.consumer_key,
      consumer_secret: data.consumerSecret?.trim() || prev.consumer_secret,
    };
    const { error } = await supabase
      .from("channels")
      .update({
        config,
        detail: hasKeys(config)
          ? `Woo REST v3 · ${config.site_url}`
          : `Store API (no REST keys yet) · ${config.site_url}`,
        status: "Connected",
        health: hasKeys(config) ? 100 : 70,
        is_enabled: data.enable ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", DEFAULT_ORG_ID)
      .eq("type", "wordpress");
    if (error) {
      if (/invalid input value for enum|wordpress/i.test(error.message)) {
        throw new Error("Run migration 034 + 034b in Supabase before saving WordPress credentials.");
      }
      throw new Error(error.message);
    }
    return { ok: true, hasKeys: hasKeys(config), siteUrl: config.site_url };
  });

export const inspectWordpressCatalog = createServerFn({ method: "POST" }).handler(async () => {
  const cfg = await loadWordpressConfig();
  const siteUrl = cfg.site_url || WORDPRESS_DEFAULT_SITE;

  const storeProbe = await fetchJson(`${siteUrl}/wp-json/wc/store/v1/products?per_page=5`);
  const storeRows = storeProbe.ok ? productRowsFromJson(storeProbe.json) : [];

  let restV3Ok = false;
  let restV3Status: number | null = null;
  let restRows: unknown[] = [];
  if (hasKeys(cfg)) {
    const url = new URL(`${siteUrl}/wp-json/wc/v3/products`);
    url.searchParams.set("status", "publish");
    url.searchParams.set("per_page", "5");
    url.searchParams.set("consumer_key", cfg.consumer_key);
    url.searchParams.set("consumer_secret", cfg.consumer_secret);
    const rest = await fetchJson(url.toString());
    restV3Status = rest.status;
    restV3Ok = rest.ok;
    restRows = rest.ok ? productRowsFromJson(rest.json) : [];
  } else {
    const rest = await fetchJson(`${siteUrl}/wp-json/wc/v3/products?per_page=1`);
    restV3Status = rest.status;
    restV3Ok = rest.ok;
  }

  const wpV2 = await fetchJson(`${siteUrl}/wp-json/wp/v2/product?per_page=1`);
  const rawSample = (restRows.length ? restRows : storeRows).slice(0, 5);
  const mapped = rawSample
    .map((row) => (restRows.length ? mapRestProduct(asRecord(row)) : mapStoreProduct(asRecord(row))))
    .filter((p): p is MappedWooProduct => Boolean(p));

  let pdfMediaHits = 0;
  try {
    const media = await fetchPdfMediaIndex(siteUrl);
    pdfMediaHits = media.size;
    for (const p of mapped) {
      if (!p.catalogueUrl) p.catalogueUrl = media.get(p.wordpressId) || null;
    }
  } catch {
    pdfMediaHits = 0;
  }

  const storeTotal = Number(storeProbe.header("X-WP-Total") || storeProbe.header("x-wp-total") || "");
  const sample: WordpressInspectSample[] = mapped.map((p) => ({
    id: p.wordpressId,
    name: p.name,
    sku: p.sku.startsWith("WOO-") || p.sku === p.slug ? "" : p.sku,
    mappedSku: p.sku,
    priceLabel: p.priceLabel,
    imageUrl: p.imageUrl,
    catalogueUrl: p.catalogueUrl,
    category: p.category,
  }));

  const hint = !hasKeys(cfg)
    ? restV3Status === 401
      ? "Store API is public (names + photos). Woo REST v3 returned 401 — paste Consumer Key + Secret for prices, descriptions, and download PDFs."
      : "Save the site URL, then paste Woo REST keys for full catalog fields. Inspect still works on the public Store API."
    : restV3Ok
      ? "Woo REST v3 authenticated. Sync now will upsert published products by SKU (or WOO-{id}/slug)."
      : `REST keys saved but Woo REST v3 returned ${restV3Status}. Check key permissions (read) on ${siteUrl}.`;

  return {
    siteUrl,
    storeApiOk: storeProbe.ok,
    restV3Ok,
    restV3Status,
    wpV2Ok: wpV2.ok,
    hasKeys: hasKeys(cfg),
    estimatedTotal: Number.isFinite(storeTotal) ? storeTotal : mapped.length || null,
    skuEmpty: sample.filter((s) => !s.sku).length,
    withImage: sample.filter((s) => s.imageUrl).length,
    withPdf: sample.filter((s) => s.catalogueUrl).length,
    withPrice: sample.filter((s) => s.priceLabel).length,
    sample,
    pdfHint: pdfMediaHits
      ? `${pdfMediaHits} PDF attachments found in WP media library.`
      : "No product-attached PDFs found in public media. REST keys may expose Woo download files / catalogue meta.",
    hint,
  } satisfies WordpressInspectResult;
});

export const syncWordpressCatalog = createServerFn({ method: "POST" }).handler(async () => {
  const ensured = await ensureWordpressChannelRow();
  if (!ensured.ok) throw new Error(ensured.error || "WordPress channel is missing.");
  const cfg = await loadWordpressConfig();
  const rest = await fetchRestV3Products(cfg);
  const store = rest.products.length ? null : await fetchStoreProducts(cfg);
  const products = rest.products.length ? rest.products : store?.products || [];
  const source = rest.products.length ? "wc/v3" : store?.ok && store.products.length ? "wc/store" : null;

  if (!source || !products.length) {
    const err =
      rest.status === 401 || rest.status === 403
        ? rest.error ||
          "Woo REST v3 unauthorized. Check Consumer Key + Secret (Read permission) and try Inspect catalog."
        : rest.error && rest.status >= 400
          ? rest.error
          : store && !store.ok
            ? `Could not reach Woo Store API (${store.status}). Check site URL ${cfg.site_url}.`
            : `Could not read Woo products at ${cfg.site_url} (REST HTTP ${rest.status || "—"}, Store HTTP ${store?.status ?? "—"}). Theme HTML in the API response is now stripped — try Sync now again.`;
    await stampSync({
      last_sync_error: err,
      last_sync_result: "0 products",
      status: "Action Required",
      health: 40,
      detail: err,
    });
    throw new Error(err);
  }

  let pdfIndex = new Map<number, string>();
  try {
    pdfIndex = await fetchPdfMediaIndex(cfg.site_url);
  } catch {
    pdfIndex = new Map();
  }
  for (const p of products) {
    if (!p.catalogueUrl) p.catalogueUrl = pdfIndex.get(p.wordpressId) || null;
  }

  const result = await upsertProducts(products);
  const summary = `${source}: ${products.length} pulled · ${result.created} new · ${result.updated} updated · ${result.deactivated} unpublished`;
  await stampSync({
    last_sync_at: new Date().toISOString(),
    last_sync_result: summary,
    last_sync_error: result.errors[0] || null,
    product_count: products.length,
    status: "Connected",
    health: hasKeys(cfg) ? 100 : 70,
    is_enabled: true,
    detail: summary,
  });

  return {
    source,
    fetched: products.length,
    created: result.created,
    updated: result.updated,
    deactivated: result.deactivated,
    withImage: products.filter((p) => p.imageUrl).length,
    withPdf: products.filter((p) => p.catalogueUrl).length,
    withPrice: products.filter((p) => p.priceLabel).length,
    errors: result.errors,
    lastSyncAt: new Date().toISOString(),
  };
});
