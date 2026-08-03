import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";

/**
 * Short catalogue redirect: /c/{sku} → Supabase Storage PDF URL.
 * Public (no auth). Used in WhatsApp / chat so links stay short.
 * Example: https://your-app.onrender.com/c/EN-3000X
 */
const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const BUCKET = "knowledge";

function publicFileUrl(path: string): string {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
}

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
            catalog_pdf_url?: string | null;
            catalog_pdf_path?: string | null;
            is_active?: boolean | null;
          } | null = null;

          const exact = await supabase
            .from("products")
            .select("catalog_pdf_url, catalog_pdf_path, is_active")
            .eq("org_id", ORG_ID)
            .eq("sku", sku)
            .maybeSingle();

          if (exact.data) {
            product = exact.data;
          } else {
            // Case-insensitive fallback
            const fuzzy = await supabase
              .from("products")
              .select("catalog_pdf_url, catalog_pdf_path, is_active")
              .eq("org_id", ORG_ID)
              .ilike("sku", sku)
              .limit(1)
              .maybeSingle();
            product = fuzzy.data;
          }

          if (!product || product.is_active === false) {
            return new Response("Catalogue not found", { status: 404 });
          }

          const target =
            (product.catalog_pdf_url as string | null) ||
            (product.catalog_pdf_path ? publicFileUrl(product.catalog_pdf_path as string) : null);

          if (!target) {
            return new Response("Catalogue not found", { status: 404 });
          }

          return new Response(null, {
            status: 302,
            headers: {
              Location: target,
              "Cache-Control": "public, max-age=300",
            },
          });
        } catch (err) {
          console.error("catalogue short-link error", err);
          return new Response("Catalogue unavailable", { status: 502 });
        }
      },
    },
  },
});
