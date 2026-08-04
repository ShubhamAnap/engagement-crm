/**
 * Stream Knowledge / product files through the app (no redirect to supabase.co).
 * Many mobile networks block or fail to reach *.supabase.co Storage URLs.
 */
import { createServiceSupabase } from "@/lib/supabase";

const BUCKET = "knowledge";

function guessContentType(pathOrName: string, fallback = "application/octet-stream"): string {
  const lower = pathOrName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return fallback;
}

export async function proxyStorageObject(options: {
  storagePath: string;
  downloadName?: string;
  mimeType?: string | null;
}): Promise<Response> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).download(options.storagePath);
  if (error || !data) {
    console.error("storage proxy download failed", options.storagePath, error?.message);
    return new Response("File unavailable", { status: 502 });
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  const fileName =
    (options.downloadName || options.storagePath.split("/").pop() || "file.pdf").replace(
      /[\\"]/g,
      "",
    );
  const contentType =
    options.mimeType ||
    data.type ||
    guessContentType(fileName) ||
    guessContentType(options.storagePath);

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
