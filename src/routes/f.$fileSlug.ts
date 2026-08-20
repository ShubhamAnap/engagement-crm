import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabase } from "@/lib/supabase";
import { resolveOrgIdFromLinkToken } from "@/server/org-context";
import { proxyStorageObject } from "@/server/storage-proxy";

/**
 * Friendly datasheet link: /f/BESS-Product-catalouge-645405bf.pdf?w={workspace}
 * Streams the PDF through this app (no redirect to supabase.co).
 *
 * Postgres uuid columns do NOT support LIKE — match first UUID segment via range + JS.
 * Only 8 hex chars of the document id are in the slug, so `?w=` scopes the lookup to the
 * sharing workspace; without it an 8-hex collision could surface another tenant's file.
 *
 * Mobile browsers (esp. WhatsApp WebView) often fail on raw application/pdf responses
 * ("This site can't be loaded"). For normal browser Accept: text/html we serve a small
 * download page; Meta/WhatsApp fetchers and ?download=1 still get the raw PDF.
 */

const DOC_COLUMNS = "id, org_id, storage_path, mime_type, title, metadata, status";

function matchesShortId(rowId: unknown, shortId: string): boolean {
  const id = String(rowId).toLowerCase();
  return id.startsWith(`${shortId}-`) || id.replace(/-/g, "").startsWith(shortId);
}

async function findDocByShortId(
  supabase: ReturnType<typeof createServiceSupabase>,
  shortId: string,
  orgId: string | null,
) {
  const id = shortId.toLowerCase();

  let rangeQuery = supabase
    .from("knowledge_documents")
    .select(DOC_COLUMNS)
    .gte("id", `${id}-0000-0000-0000-000000000000`)
    .lte("id", `${id}-ffff-ffff-ffff-ffffffffffff`)
    .limit(20);
  if (orgId) rangeQuery = rangeQuery.eq("org_id", orgId);

  const { data: ranged, error: rangeErr } = await rangeQuery;

  if (rangeErr) {
    console.error("datasheet id range lookup failed", rangeErr.message);
  }

  const doc = (ranged || []).find((r) => matchesShortId(r.id, id)) || null;
  if (doc) return doc;

  let fallbackQuery = supabase
    .from("knowledge_documents")
    .select(DOC_COLUMNS)
    .eq("status", "ready")
    .limit(300);
  if (orgId) fallbackQuery = fallbackQuery.eq("org_id", orgId);

  const { data: all, error: allErr } = await fallbackQuery;

  if (allErr) {
    console.error("datasheet fallback lookup failed", allErr.message);
    return null;
  }

  const hits = (all || []).filter((r) => matchesShortId(r.id, id));
  if (hits.length === 0) return null;

  // Same id prefix in two workspaces and no ?w= to disambiguate — refuse rather than guess.
  if (!orgId && new Set(hits.map((r) => String(r.org_id))).size > 1) return null;
  return hits[0];
}

/** Meta / WhatsApp / API clients need the raw PDF bytes, not an HTML wrapper. */
function wantsRawPdf(request: Request): boolean {
  const url = new URL(request.url);
  if (url.searchParams.has("raw") || url.searchParams.get("download") === "1") {
    return true;
  }
  const ua = (request.headers.get("user-agent") || "").toLowerCase();
  if (
    /facebookexternalhit|facebot|whatsapp|meta-externalagent|curl\/|wget|axios|node-fetch|python-requests|go-http-client/.test(
      ua,
    )
  ) {
    return true;
  }
  const accept = (request.headers.get("accept") || "").toLowerCase();
  // Prefer HTML landing only when the client clearly wants a page
  if (accept.includes("text/html") && !accept.includes("application/pdf")) {
    return false;
  }
  return true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mobileDownloadPage(fileName: string, downloadHref: string): Response {
  const safe = escapeHtml(fileName);
  const href = escapeHtml(downloadHref);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safe}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0; min-height: 100dvh; display: grid; place-items: center;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: linear-gradient(165deg, #e8eefc 0%, #f7f8fb 45%, #ffffff 100%);
      color: #0b2388; padding: 24px;
    }
    main {
      width: min(420px, 100%); text-align: center;
    }
    .brand { font-size: 0.85rem; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.7; margin-bottom: 12px; }
    h1 { font-size: 1.25rem; font-weight: 650; margin: 0 0 8px; line-height: 1.35; word-break: break-word; }
    p { margin: 0 0 20px; color: #334155; font-size: 0.95rem; line-height: 1.45; }
    a.btn {
      display: inline-block; background: #0b2388; color: #fff; text-decoration: none;
      padding: 14px 22px; border-radius: 10px; font-weight: 600; font-size: 1rem;
    }
    a.btn:active { opacity: 0.9; }
    .hint { margin-top: 18px; font-size: 0.8rem; color: #64748b; }
  </style>
</head>
<body>
  <main>
    <div class="brand">File Preview</div>
    <h1>${safe}</h1>
    <p>Tap below to download this datasheet PDF. If WhatsApp’s browser fails, open the link in Chrome or Safari.</p>
    <a class="btn" href="${href}" download="${safe}">Download PDF</a>
    <p class="hint">File opens with your phone’s PDF reader after download.</p>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=120",
    },
  });
}

export const Route = createFileRoute("/f/$fileSlug")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
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

          const token = new URL(request.url).searchParams.get("w");
          const orgId = await resolveOrgIdFromLinkToken(supabase, token);
          if (token && !orgId) {
            return new Response("File not found", { status: 404 });
          }

          const doc = await findDocByShortId(supabase, shortId, orgId);

          if (!doc?.storage_path || String(doc.status) === "failed") {
            return new Response("File not found", { status: 404 });
          }

          const metaName = String((doc.metadata as { fileName?: string } | null)?.fileName || "");
          const downloadName =
            metaName ||
            (String(doc.title || "").trim()
              ? `${String(doc.title).trim()}${/\.pdf$/i.test(String(doc.title)) ? "" : ".pdf"}`
              : fileSlug);

          if (!wantsRawPdf(request)) {
            const url = new URL(request.url);
            url.searchParams.set("download", "1");
            return mobileDownloadPage(downloadName, `${url.pathname}${url.search}`);
          }

          const forceDownload = new URL(request.url).searchParams.get("download") === "1";
          return proxyStorageObject({
            storagePath: doc.storage_path as string,
            downloadName,
            mimeType: (doc.mime_type as string | null) || "application/pdf",
            disposition: forceDownload ? "attachment" : "inline",
          });
        } catch (err) {
          console.error("datasheet short-link error", err);
          return new Response("File unavailable", { status: 502 });
        }
      },
    },
  },
});
