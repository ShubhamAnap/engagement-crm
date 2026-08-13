/**
 * Product image / catalogue PDF upload via service role (bypasses Storage RLS).
 * Client tries direct upload first; falls back here on failure.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { normalizeCategoryKey } from "@/lib/product-card";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const BUCKET = "knowledge";

function publicFileUrl(path: string): string {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function ensureBucket() {
  const supabase = createServiceSupabase();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(`Could not list storage buckets: ${listError.message}. Check SUPABASE_SERVICE_ROLE_KEY.`);
  }
  const exists = (buckets ?? []).some((b) => b.id === BUCKET || b.name === BUCKET);
  if (exists) return;
  const { error: createError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 15 * 1024 * 1024,
  });
  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(`Could not create knowledge bucket: ${createError.message}`);
  }
}

export const uploadProductMediaServer = createServerFn({ method: "POST" })
  .validator(
    z.object({
      productId: z.string().uuid(),
      kind: z.enum(["image", "pdf"]),
      fileName: z.string().min(1).max(240),
      contentType: z.string().max(120).optional(),
      base64: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    await ensureBucket();
    const supabase = createServiceSupabase();

    const { data: product, error: pErr } = await supabase
      .from("products")
      .select("id, org_id")
      .eq("id", data.productId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!product) throw new Error("Product not found");

    const buffer = Buffer.from(data.base64, "base64");
    if (data.kind === "image") {
      if (buffer.length > 5 * 1024 * 1024) throw new Error("Product image max size is 5 MB");
    } else if (buffer.length > 12 * 1024 * 1024) {
      throw new Error("Catalogue PDF max size is 12 MB");
    }

    const lower = data.fileName.toLowerCase();
    let contentType = data.contentType || "application/octet-stream";
    let storagePath: string;

    if (data.kind === "image") {
      const ext = lower.endsWith(".png")
        ? "png"
        : lower.endsWith(".webp")
          ? "webp"
          : "jpg";
      contentType =
        contentType.startsWith("image/")
          ? contentType
          : ext === "png"
            ? "image/png"
            : ext === "webp"
              ? "image/webp"
              : "image/jpeg";
      storagePath = `${ORG_ID}/products/${data.productId}/card.${ext}`;
    } else {
      if (!lower.endsWith(".pdf") && !String(contentType).includes("pdf")) {
        throw new Error("Catalogue must be a PDF file");
      }
      const safeName = data.fileName.replace(/[^\w.\-]+/g, "_") || "catalogue.pdf";
      contentType = "application/pdf";
      storagePath = `${ORG_ID}/products/${data.productId}/${safeName}`;
    }

    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => undefined);
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });
    if (uploadError) {
      throw new Error(
        `Storage upload failed: ${uploadError.message}. Ensure knowledge bucket exists (run 005_knowledge_storage_fix.sql).`,
      );
    }

    const publicUrl = publicFileUrl(storagePath);
    const patch =
      data.kind === "image"
        ? { image_path: storagePath, image_url: publicUrl }
        : { catalog_pdf_path: storagePath, catalog_pdf_url: publicUrl };

    const { data: updated, error: uErr } = await supabase
      .from("products")
      .update(patch)
      .eq("id", data.productId)
      .eq("org_id", ORG_ID)
      .select("*")
      .single();

    if (uErr) {
      const msg = uErr.message || "Could not save product media path";
      if (/image_path|image_url/i.test(msg)) {
        throw new Error(`${msg} — run migration 019_product_image.sql in Supabase.`);
      }
      if (/catalog_pdf/i.test(msg)) {
        throw new Error(`${msg} — run migration 004_knowledge_rag.sql in Supabase.`);
      }
      throw new Error(msg);
    }

    return updated;
  });

export const uploadCategoryCatalogueServer = createServerFn({ method: "POST" })
  .validator(
    z.object({
      categoryLabel: z.string().min(1).max(160),
      fileName: z.string().min(1).max(240),
      contentType: z.string().max(120).optional(),
      base64: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    await ensureBucket();
    const supabase = createServiceSupabase();
    const buffer = Buffer.from(data.base64, "base64");
    if (buffer.length > 12 * 1024 * 1024) throw new Error("Catalogue PDF max size is 12 MB");
    const label = data.categoryLabel.trim().replace(/\s+/g, " ");
    const key = normalizeCategoryKey(label);
    if (!key) throw new Error("Category name is required");
    const lower = data.fileName.toLowerCase();
    if (!lower.endsWith(".pdf") && !String(data.contentType || "").includes("pdf")) {
      throw new Error("Catalogue must be a PDF file");
    }
    const safeName = data.fileName.replace(/[^\w.\-]+/g, "_") || "catalogue.pdf";
    const storagePath = `${ORG_ID}/category-catalogues/${key}/${safeName}`;
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => undefined);
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }
    const publicUrl = publicFileUrl(storagePath);
    const { data: row, error } = await supabase
      .from("product_category_catalogues")
      .upsert(
        {
          org_id: ORG_ID,
          category_key: key,
          category_label: label,
          catalog_pdf_path: storagePath,
          catalog_pdf_url: publicUrl,
        },
        { onConflict: "org_id,category_key" },
      )
      .select("*")
      .single();
    if (error) {
      throw new Error(
        `${error.message} — run migration 035_category_catalogues.sql in Supabase SQL Editor.`,
      );
    }
    return row;
  });
