import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";
import { proxyStorageObject } from "@/server/storage-proxy";

/**
 * Short knowledge-document link: /d/{documentId}
 * Streams file through this app (no redirect to supabase.co).
 */
function extensionFromMime(mime: string | null | undefined): string {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  if (m.includes("gif")) return ".gif";
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
  if (m.includes("pdf")) return ".pdf";
  if (m.includes("wordprocessingml") || m.includes("msword")) return ".docx";
  return "";
}

function downloadNameForDoc(options: {
  title: string;
  mimeType: string | null;
  fileName: string;
}): string {
  const metaName = options.fileName.trim();
  if (metaName && /\.[a-z0-9]{2,5}$/i.test(metaName)) return metaName.replace(/[\\/]+/g, "-");

  const title = String(options.title || "document").trim() || "document";
  if (/\.[a-z0-9]{2,5}$/i.test(title)) return title.replace(/[\\/]+/g, "-");

  const ext = extensionFromMime(options.mimeType) || ".bin";
  return `${title.replace(/[\\/]+/g, "-")}${ext}`;
}

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
            .eq("id", documentId)
            .maybeSingle();

          if (!doc?.storage_path || String(doc.status) === "failed") {
            return new Response("File not found", { status: 404 });
          }

          const metaName = String((doc.metadata as { fileName?: string } | null)?.fileName || "");
          const downloadName = downloadNameForDoc({
            title: String(doc.title || "document"),
            mimeType: (doc.mime_type as string | null) || null,
            fileName: metaName,
          });

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
