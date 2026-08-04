import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";
import { proxyStorageObject } from "@/server/storage-proxy";

/**
 * Short knowledge-document link: /d/{documentId}
 * Streams file through this app (no redirect to supabase.co).
 */
const ORG_ID = "a0000000-0000-4000-8000-000000000001";

export const Route = createFileRoute("/d/$documentId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const documentId = decodeURIComponent(params.documentId || "").trim();
        if (!documentId) {
          return new Response("File not found", { status: 404 });
        }

        try {
          const supabase = createServiceSupabase();
          const { data: doc } = await supabase
            .from("knowledge_documents")
            .select("storage_path, mime_type, title, metadata, status")
            .eq("org_id", ORG_ID)
            .eq("id", documentId)
            .maybeSingle();

          if (!doc?.storage_path || String(doc.status) === "failed") {
            return new Response("File not found", { status: 404 });
          }

          const metaName = String((doc.metadata as { fileName?: string } | null)?.fileName || "");
          const downloadName =
            metaName ||
            (String(doc.title || "document").trim() +
              (/\.pdf$/i.test(String(doc.title || "")) ? "" : ".pdf"));

          return proxyStorageObject({
            storagePath: doc.storage_path as string,
            downloadName,
            mimeType: (doc.mime_type as string | null) || undefined,
          });
        } catch (err) {
          console.error("knowledge short-link error", err);
          return new Response("File unavailable", { status: 502 });
        }
      },
    },
  },
});
