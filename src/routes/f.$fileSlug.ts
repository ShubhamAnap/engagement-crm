import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";

/**
 * Friendly datasheet redirect: /f/E-Series-Solar-aaf86f2d.pdf → Storage PDF.
 * Public (no auth). Looks like a real PDF filename in chat / WhatsApp.
 */
const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const BUCKET = "knowledge";

function publicFileUrl(path: string): string {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
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

          let doc:
            | {
                storage_path?: string | null;
                source_url?: string | null;
                status?: string | null;
              }
            | null = null;

          if (shortId) {
            const { data: rows } = await supabase
              .from("knowledge_documents")
              .select("id, storage_path, source_url, status")
              .eq("org_id", ORG_ID)
              .like("id", `${shortId}%`)
              .limit(5);
            doc =
              (rows || []).find((r) => String(r.id).replace(/-/g, "").startsWith(shortId)) ||
              (rows || [])[0] ||
              null;
          }

          if (!doc) {
            return new Response("File not found", { status: 404 });
          }
          if (String(doc.status) === "failed") {
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
              "Content-Disposition": `inline; filename="${fileSlug.replace(/"/g, "")}"`,
            },
          });
        } catch (err) {
          console.error("datasheet short-link error", err);
          return new Response("File unavailable", { status: 502 });
        }
      },
    },
  },
});
