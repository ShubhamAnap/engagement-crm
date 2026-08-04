import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";
import { proxyStorageObject } from "@/server/storage-proxy";

/**
 * Friendly datasheet link: /f/BESS-Product-catalouge-645405bf.pdf
 * Streams the PDF through this app (no redirect to supabase.co).
 *
 * Note: Postgres uuid columns do not support LIKE — we match the first UUID segment
 * with a range query, then confirm the prefix in JS.
 */
const ORG_ID = "a0000000-0000-4000-8000-000000000001";

async function findDocByShortId(
  supabase: ReturnType<typeof createServiceSupabase>,
  shortId: string,
) {
  const id = shortId.toLowerCase();

  // Range on uuid first segment (8 hex chars). Avoids unsupported uuid LIKE.
  const { data: ranged, error: rangeErr } = await supabase
    .from("knowledge_documents")
    .select("id, storage_path, mime_type, title, metadata, status")
    .eq("org_id", ORG_ID)
    .gte("id", `${id}-0000-0000-0000-000000000000`)
    .lte("id", `${id}-ffff-ffff-ffff-ffffffffffff`)
    .limit(20);

  if (rangeErr) {
    console.error("datasheet id range lookup failed", rangeErr.message);
  }

  let doc =
    (ranged || []).find(
      (r) =>
        String(r.id).toLowerCase().startsWith(`${id}-`) ||
        String(r.id).replace(/-/g, "").toLowerCase().startsWith(id),
    ) || null;

  if (doc) return doc;

  // Fallback: scan ready docs (org is small) and match prefix in JS
  const { data: all, error: allErr } = await supabase
    .from("knowledge_documents")
    .select("id, storage_path, mime_type, title, metadata, status")
    .eq("org_id", ORG_ID)
    .eq("status", "ready")
    .limit(300);

  if (allErr) {
    console.error("datasheet fallback lookup failed", allErr.message);
    return null;
  }

  return (
    (all || []).find(
      (r) =>
        String(r.id).toLowerCase().startsWith(`${id}-`) ||
        String(r.id).replace(/-/g, "").toLowerCase().startsWith(id),
    ) || null
  );
}

export const Route = createFileRoute("/f/$fileSlug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const fileSlug = decodeURIComponent(params.fileSlug || "").trim();
        if (!fileSlug) {
          return new Response("File not found", { status: 404 });
        }

        try {
          const supabase = createServiceSupabase();
          const idMatch = fileSlug.match(/-([0-9a-f]{8})(?:\.pdf)?$/i);
          const shortId = idMatch?.[1]?.toLowerCase();
          if (!shortId) {
            return new Response("File not found", { status: 404 });
          }

          const doc = await findDocByShortId(supabase, shortId);

          if (!doc?.storage_path || String(doc.status) === "failed") {
            return new Response("File not found", { status: 404 });
          }

          const metaName = String((doc.metadata as { fileName?: string } | null)?.fileName || "");
          const downloadName =
            metaName ||
            (String(doc.title || "").trim()
              ? `${String(doc.title).trim()}${/\.pdf$/i.test(String(doc.title)) ? "" : ".pdf"}`
              : fileSlug);

          return proxyStorageObject({
            storagePath: doc.storage_path as string,
            downloadName,
            mimeType: (doc.mime_type as string | null) || "application/pdf",
          });
        } catch (err) {
          console.error("datasheet short-link error", err);
          return new Response("File unavailable", { status: 502 });
        }
      },
    },
  },
});
