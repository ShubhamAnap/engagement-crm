import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";
import { proxyStorageObject } from "@/server/storage-proxy";

/**
 * Short catalogue link: /c/{sku}
 * Streams PDF through this app (no redirect to supabase.co).
 */
const ORG_ID = "a0000000-0000-4000-8000-000000000001";

export const Route = createFileRoute("/c/$sku")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const sku = decodeURIComponent(params.sku || "").trim();
        if (!sku) {
          return new Response("Catalogue not found", { status: 404 });
        }

        try {
          const supabase = createServiceSupabase();
          let product: {
            name?: string | null;
            catalog_pdf_url?: string | null;
            catalog_pdf_path?: string | null;
            is_active?: boolean | null;
          } | null = null;

          const exact = await supabase
            .from("products")
            .select("name, catalog_pdf_url, catalog_pdf_path, is_active")
            .eq("org_id", ORG_ID)
            .eq("sku", sku)
            .maybeSingle();

          if (exact.data) {
            product = exact.data;
          } else {
            const fuzzy = await supabase
              .from("products")
              .select("name, catalog_pdf_url, catalog_pdf_path, is_active")
              .eq("org_id", ORG_ID)
              .ilike("sku", sku)
              .limit(1)
              .maybeSingle();
            product = fuzzy.data;
          }

          if (!product || product.is_active === false) {
            return new Response("Catalogue not found", { status: 404 });
          }

          let storagePath = (product.catalog_pdf_path as string | null) || null;
          if (!storagePath && product.catalog_pdf_url) {
            const m = String(product.catalog_pdf_url).match(
              /\/storage\/v1\/object\/public\/knowledge\/(.+?)(?:\?|#|$)/i,
            );
            storagePath = m?.[1] ? decodeURIComponent(m[1]) : null;
          }

          if (!storagePath && product.catalog_pdf_url && /^https:\/\//i.test(product.catalog_pdf_url)) {
            return Response.redirect(product.catalog_pdf_url, 302);
          }

          if (!storagePath) {
            return new Response("Catalogue not found", { status: 404 });
          }

          const downloadName = `${String(product.name || sku).trim() || "catalogue"}.pdf`;
          return proxyStorageObject({
            storagePath,
            downloadName,
            mimeType: "application/pdf",
          });
        } catch (err) {
          console.error("catalogue short-link error", err);
          return new Response("Catalogue unavailable", { status: 502 });
        }
      },
    },
  },
});
