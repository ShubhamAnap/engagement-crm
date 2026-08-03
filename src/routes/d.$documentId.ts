import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";

/**
 * Short knowledge-document redirect: /d/{documentId} → Storage PDF/image URL.
 * Public (no auth). Used when sharing KB files in chat / WhatsApp.
 */
const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const BUCKET = "knowledge";

function publicFileUrl(path: string): string {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
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
            .select("storage_path, source_url, status")
            .eq("org_id", ORG_ID)
            .eq("id", documentId)
            .maybeSingle();

          if (!doc || String(doc.status) === "failed") {
            return new Response("File not found", { status: 404 });
          }

          const target =
            (doc.storage_path ? publicFileUrl(doc.storage_path as string) : null) ||
            (doc.source_url as string | null);

          if (!target) {
            return new Response("File not found", { status: 404 });
          }

          return new Response(null, {
            status: 302,
            headers: {
              Location: target,
              "Cache-Control": "public, max-age=300",
            },
          });
        } catch (err) {
          console.error("knowledge short-link error", err);
          return new Response("File unavailable", { status: 502 });
        }
      },
    },
  },
});
