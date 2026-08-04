import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";
import { proxyStorageObject } from "@/server/storage-proxy";

/**
 * Friendly datasheet link: /f/BESS-Product-catalouge-645405bf.pdf
 * Streams the PDF from Storage through this app (no redirect to supabase.co).
 */
const ORG_ID = "a0000000-0000-4000-8000-000000000001";

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

          let doc: {
            id?: string;
            storage_path?: string | null;
            mime_type?: string | null;
            title?: string | null;
            metadata?: { fileName?: string } | null;
            status?: string | null;
          } | null = null;

          if (shortId) {
            const { data: rows } = await supabase
              .from("knowledge_documents")
              .select("id, storage_path, mime_type, title, metadata, status")
              .eq("org_id", ORG_ID)
              .like("id", `${shortId}%`)
              .limit(5);
            doc =
              (rows || []).find((r) => String(r.id).replace(/-/g, "").startsWith(shortId)) ||
              (rows || [])[0] ||
              null;
          }

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
