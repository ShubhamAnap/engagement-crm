import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";
import { normalizeCategoryKey } from "@/lib/product-card";
import { resolveOrgIdFromLinkToken } from "@/server/org-context";
import { proxyStorageObject } from "@/server/storage-proxy";

/**
 * Short catalogue link: /c/{sku}?w={workspace}
 * Streams PDF through this app (no redirect to supabase.co).
 *
 * SKUs are unique per workspace, not globally. `?w=` names the workspace that
 * shared the link; links without it only work when exactly one workspace owns
 * the SKU, so we never hand a customer another tenant's catalogue.
 */

type CatalogueProduct = {
  org_id: string;
  name: string | null;
  category: string | null;
  catalog_pdf_url: string | null;
  catalog_pdf_path: string | null;
};

const PRODUCT_COLUMNS = "org_id, name, category, catalog_pdf_url, catalog_pdf_path, is_active";

async function findProduct(
  supabase: ReturnType<typeof createServiceSupabase>,
  sku: string,
  orgId: string | null,
): Promise<CatalogueProduct | null> {
  for (const exact of [true, false]) {
    let q = supabase.from("products").select(PRODUCT_COLUMNS).limit(4);
    q = exact ? q.eq("sku", sku) : q.ilike("sku", sku);
    if (orgId) q = q.eq("org_id", orgId);

    const { data, error } = await q;
    if (error) {
      console.error("catalogue short-link lookup failed", error.message);
      return null;
    }

    const rows = (data ?? []).filter((row) => row.is_active !== false) as Array<
      CatalogueProduct & { is_active?: boolean | null }
    >;
    if (rows.length === 0) continue;

    // Ambiguous across workspaces and no ?w= to disambiguate — refuse rather than guess.
    const orgs = new Set(rows.map((row) => String(row.org_id)));
    if (orgs.size > 1) return null;
    return rows[0];
  }
  return null;
}

export const Route = createFileRoute("/c/$sku")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const sku = decodeURIComponent(params.sku || "").trim();
        if (!sku) {
          return new Response("Catalogue not found", { status: 404 });
        }

        try {
          const supabase = createServiceSupabase();
          const token = new URL(request.url).searchParams.get("w");
          const orgId = await resolveOrgIdFromLinkToken(supabase, token);
          if (token && !orgId) {
            return new Response("Catalogue not found", { status: 404 });
          }

          const product = await findProduct(supabase, sku, orgId);
          if (!product) {
            return new Response("Catalogue not found", { status: 404 });
          }

          let pdfUrl = product.catalog_pdf_url || null;
          let storagePath = product.catalog_pdf_path || null;
          if (!storagePath && !pdfUrl) {
            const catKey = normalizeCategoryKey(product.category);
            if (catKey) {
              const cat = await supabase
                .from("product_category_catalogues")
                .select("catalog_pdf_url, catalog_pdf_path")
                .eq("org_id", product.org_id)
                .eq("category_key", catKey)
                .maybeSingle();
              pdfUrl = (cat.data?.catalog_pdf_url as string | null) || null;
              storagePath = (cat.data?.catalog_pdf_path as string | null) || null;
            }
          }
          if (!storagePath && pdfUrl) {
            const m = String(pdfUrl).match(
              /\/storage\/v1\/object\/public\/knowledge\/(.+?)(?:\?|#|$)/i,
            );
            storagePath = m?.[1] ? decodeURIComponent(m[1]) : null;
          }

          if (!storagePath && pdfUrl && /^https:\/\//i.test(pdfUrl)) {
            return Response.redirect(pdfUrl, 302);
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
