import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  brainmineConfigReady,
  brainmineHttpJson,
  loadBrainmineConfig,
  type BrainmineChannelConfig,
} from "@/server/brainmine";

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function extractRows(json: unknown): Record<string, unknown>[] {
  const data = getByPath(json, "data");
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  return [];
}

function asDoc(json: unknown): Record<string, unknown> {
  const data = getByPath(json, "data");
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  if (json && typeof json === "object" && !Array.isArray(json)) {
    return json as Record<string, unknown>;
  }
  throw new Error("Brainmine document response was empty");
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function previewValue(v: unknown, max = 220): string {
  if (v == null) return "";
  if (typeof v === "string") return v.length > max ? `${v.slice(0, max)}...` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > max ? `${s.slice(0, max)}...` : s;
  } catch {
    return String(v);
  }
}

function looksLikeLinkField(key: string, value: unknown): boolean {
  const k = key.toLowerCase();
  const text = String(value || "").toLowerCase();
  return (
    /pdf|file|attach|print|download|url|link/.test(k) ||
    /^https?:\/\//.test(text) ||
    /\.pdf(\?|#|$)/i.test(text)
  );
}

function internalPrintUrl(cfg: BrainmineChannelConfig, doctype: string, docId: string): string | null {
  const base = cfg.api_base_url?.trim().replace(/\/$/, "");
  if (!base) return null;
  return `${base}/app/print/${encodeURIComponent(doctype)}/${encodeURIComponent(docId)}`;
}

export const inspectBrainmineQuotationProbe = createServerFn({ method: "POST" })
  .validator(
    z.object({
      quoteId: z.string().min(1).max(120).default("SAL-QTN-2026-01445"),
      doctype: z.string().min(1).max(120).default("Quotation"),
    }),
  )
  .handler(async ({ data }) => {
    const cfg = await loadBrainmineConfig();
    if (!brainmineConfigReady(cfg)) {
      throw new Error("Configure Brainmine API base URL and API key under Channels first.");
    }

    const doctype = data.doctype.trim() || "Quotation";
    const quoteId = data.quoteId.trim();
    const docPath = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(quoteId)}`;
    const rawJson = await brainmineHttpJson(cfg, docPath, { method: "GET" });
    const doc = asDoc(rawJson);

    const allFields = Object.keys(doc)
      .filter((k) => !k.startsWith("_"))
      .sort((a, b) => a.localeCompare(b))
      .map((key) => {
        const value = doc[key];
        const empty =
          value == null || value === "" || (Array.isArray(value) && value.length === 0);
        return {
          key,
          empty,
          valuePreview: previewValue(value),
          looksLikeLink: looksLikeLinkField(key, value) && !empty,
        };
      });

    const linkishFields = allFields.filter((f) => f.looksLikeLink);
    const fileFields = linkishFields.filter((f) => /pdf|file|attach|print|download|url|link/i.test(f.key));

    let linkedFiles: Array<{
      name: string;
      fileName: string | null;
      fileUrl: string | null;
      contentType: string | null;
      isPrivate: string | null;
      attachedToDoctype: string | null;
      attachedToName: string | null;
    }> = [];
    let fileLookupError: string | null = null;

    try {
      const fileFieldsQuery = encodeURIComponent(
        JSON.stringify([
          "name",
          "file_name",
          "file_url",
          "content_type",
          "is_private",
          "attached_to_doctype",
          "attached_to_name",
        ]),
      );
      const fileFilters = encodeURIComponent(
        JSON.stringify([
          ["attached_to_doctype", "=", doctype],
          ["attached_to_name", "=", quoteId],
        ]),
      );
      const fileJson = await brainmineHttpJson(
        cfg,
        `/api/resource/File?limit_page_length=20&fields=${fileFieldsQuery}&filters=${fileFilters}`,
        { method: "GET" },
      );
      linkedFiles = extractRows(fileJson).map((row) => ({
        name: asString(row.name) || "",
        fileName: asString(row.file_name),
        fileUrl: asString(row.file_url),
        contentType: asString(row.content_type),
        isPrivate: asString(row.is_private),
        attachedToDoctype: asString(row.attached_to_doctype),
        attachedToName: asString(row.attached_to_name),
      }));
    } catch (error) {
      fileLookupError = error instanceof Error ? error.message : "File lookup failed";
    }

    const hasPdfField =
      fileFields.some((f) => /\.pdf(\?|#|$)/i.test(f.valuePreview) || /pdf/i.test(f.key)) ||
      linkedFiles.some(
        (f) =>
          /\.pdf(\?|#|$)/i.test(String(f.fileUrl || "")) ||
          /\.pdf$/i.test(String(f.fileName || "")) ||
          /pdf/i.test(String(f.contentType || "")),
      );

    const classification = hasPdfField
      ? ("pdf_available" as const)
      : allFields.length > 0
        ? ("quote_data_only" as const)
        : ("insufficient" as const);

    const diagnosis =
      classification === "pdf_available"
        ? "Brainmine exposes at least one PDF/file hint for this quotation. Review linked files and link-like fields below before wiring customer delivery."
        : classification === "quote_data_only"
          ? "Brainmine returned quotation data, but this probe did not find a direct PDF/file attachment. Most likely we can generate PDF on our side from quote JSON."
          : "Brainmine did not expose enough quotation data from this quotation path.";

    return {
      quoteId,
      doctype,
      docPath,
      internalPrintUrl: internalPrintUrl(cfg, doctype, quoteId),
      sampleFieldCount: allFields.length,
      classification,
      diagnosis,
      hint:
        "This probe is read-only. If PDF is missing here but the quotation record looks complete, the next path is customer PDF generation from quotation JSON.",
      allFields,
      linkishFields,
      linkedFiles,
      fileLookupError,
      rawFieldHints: {
        fileFieldCount: fileFields.length,
        linkishFieldCount: linkishFields.length,
      },
    };
  });
