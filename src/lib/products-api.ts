import { getBrowserSupabase } from "@/lib/supabase";
import type { DbProduct, StockStatus } from "@/lib/db-types";

const KNOWLEDGE_BUCKET = "knowledge";

export type ProductInput = {
  orgId: string;
  sku: string;
  name: string;
  category?: string;
  description?: string;
  stockStatus?: StockStatus;
  quantity?: number;
  priceLabel?: string;
  aiWeight?: number;
  batterySpec?: string;
  runtimeSpec?: string;
};

function parsePriceToPaise(priceLabel: string | undefined): number | null {
  if (!priceLabel) return null;
  const normalized = priceLabel.replace(/[^\d.]/g, "");
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function buildProductPayload(input: ProductInput) {
  return {
    org_id: input.orgId,
    sku: input.sku.trim(),
    name: input.name.trim(),
    category: input.category?.trim() || null,
    description: input.description?.trim() || null,
    stock_status: input.stockStatus ?? "In Stock",
    quantity: input.quantity ?? 0,
    price_paise: parsePriceToPaise(input.priceLabel),
    price_label: input.priceLabel?.trim() || null,
    ai_weight: input.aiWeight ?? 0.5,
    battery_spec: input.batterySpec?.trim() || null,
    runtime_spec: input.runtimeSpec?.trim() || null,
    specs: {},
    is_active: true,
  };
}

function publicCatalogueUrl(path: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL || "";
  return `${String(base).replace(/\/$/, "")}/storage/v1/object/public/${KNOWLEDGE_BUCKET}/${path}`;
}

export async function listProducts(orgId: string): Promise<DbProduct[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data ?? []) as DbProduct[];
}

export async function createProduct(input: ProductInput): Promise<DbProduct> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("products")
    .insert(buildProductPayload(input))
    .select("*")
    .single();

  if (error) throw error;
  return data as DbProduct;
}

export async function updateProduct(productId: string, input: ProductInput): Promise<DbProduct> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("products")
    .update(buildProductPayload(input))
    .eq("id", productId)
    .select("*")
    .single();

  if (error) throw error;
  return data as DbProduct;
}

export async function deleteProduct(productId: string): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await supabase.from("products").delete().eq("id", productId);
  if (error) throw error;
}

/** Upload/replace a product catalogue PDF in the knowledge Storage bucket. */
export async function uploadProductCataloguePdf(options: {
  orgId: string;
  productId: string;
  file: File;
}): Promise<DbProduct> {
  const { orgId, productId, file } = options;
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".pdf") && file.type !== "application/pdf") {
    throw new Error("Catalogue must be a PDF file");
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("Catalogue PDF max size is 12 MB");
  }

  const supabase = getBrowserSupabase();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const storagePath = `${orgId}/products/${productId}/${safeName}`;

  const { error: uploadError } = await supabase.storage.from(KNOWLEDGE_BUCKET).upload(storagePath, file, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (uploadError) {
    throw new Error(
      `Storage upload failed: ${uploadError.message}. Ensure the knowledge bucket exists (run 005_knowledge_storage_fix.sql).`,
    );
  }

  const catalogUrl = publicCatalogueUrl(storagePath);
  const { data, error } = await supabase
    .from("products")
    .update({
      catalog_pdf_path: storagePath,
      catalog_pdf_url: catalogUrl,
    })
    .eq("id", productId)
    .eq("org_id", orgId)
    .select("*")
    .single();

  if (error) throw error;
  return data as DbProduct;
}

export async function removeProductCataloguePdf(options: {
  orgId: string;
  productId: string;
  storagePath?: string | null;
}): Promise<DbProduct> {
  const { orgId, productId, storagePath } = options;
  const supabase = getBrowserSupabase();

  if (storagePath) {
    await supabase.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
  }

  const { data, error } = await supabase
    .from("products")
    .update({
      catalog_pdf_path: null,
      catalog_pdf_url: null,
    })
    .eq("id", productId)
    .eq("org_id", orgId)
    .select("*")
    .single();

  if (error) throw error;
  return data as DbProduct;
}

export function productCatalogueHref(product: DbProduct): string | null {
  return product.catalog_pdf_url || (product.catalog_pdf_path ? publicCatalogueUrl(product.catalog_pdf_path) : null);
}
