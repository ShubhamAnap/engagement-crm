import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { chunkText, embedQuery, embedTexts, estimateTokens } from "@/server/embeddings";
import { ensurePdfFileLabel, shortDatasheetUrl, shortKnowledgeDocumentUrl } from "@/lib/short-links";
import { isAckOnlyMessage, isGreetingOnlyMessage } from "@/lib/enertech-scope";
import { isServiceIntent } from "@/lib/conversation-guards";
import { isEducateOnlyAsk, wantsSiteInstallOrReferencePhotos } from "@/lib/conversation-intent";
import { shortenStorageUrl } from "@/server/shorten-urls";

import { assertOrgStoragePath, orgStoragePath } from "@/lib/org-storage";
import { requireStaffOrgId } from "@/server/org-context";
const BUCKET = "knowledge";

function publicFileUrl(path: string): string {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** pgvector via PostgREST expects a string literal like "[0.1,0.2,...]". */
function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function isImageFile(fileName: string, mimeType?: string | null): boolean {
  const lower = fileName.toLowerCase();
  const mime = (mimeType || "").toLowerCase();
  return (
    mime.startsWith("image/") ||
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".bmp")
  );
}

/** Normalize free-form image tags (state, city, site type, …). */
export function normalizeKnowledgeTags(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,;|]/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const tag = String(item || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 40);
    if (tag.length < 2) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

function readDocTags(metadata: unknown): string[] {
  const meta = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>;
  return normalizeKnowledgeTags(meta.tags);
}

function isDocxFile(fileName: string, mimeType?: string | null): boolean {
  const lower = fileName.toLowerCase();
  const mime = (mimeType || "").toLowerCase();
  return lower.endsWith(".docx") || mime.includes("wordprocessingml");
}

function assertSupportedFile(fileName: string, mimeType?: string | null) {
  const lower = fileName.toLowerCase();
  const mime = (mimeType || "").toLowerCase();
  if (lower.endsWith(".doc") || mime.includes("msword") && !isDocxFile(fileName, mimeType)) {
    throw new Error("Legacy .doc is not supported. Save as .docx or PDF, or upload TXT/Markdown/images.");
  }
  const ok =
    isImageFile(fileName, mimeType) ||
    isDocxFile(fileName, mimeType) ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".csv") ||
    mime.includes("pdf") ||
    mime.includes("text");
  if (!ok) {
    throw new Error("Unsupported file type. Use PDF, DOCX, TXT, Markdown, or images (PNG/JPG/WEBP/GIF).");
  }
}

function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string | null,
  fileName: string,
  options?: { title?: string; collectionName?: string },
): string {
  const lower = fileName.toLowerCase();
  const mime = (mimeType || "").toLowerCase();
  const title = options?.title || fileName;
  const collection = options?.collectionName || "Knowledge Base";

  if (mime.includes("text") || lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".csv")) {
    return buffer.toString("utf8");
  }
  if (isImageFile(fileName, mimeType)) {
    return [
      `Knowledge image: ${title}.`,
      `Collection: ${collection}.`,
      `File name: ${fileName}.`,
      "This is a product/site photo available for customer viewing or download.",
      `If the visitor asks about ${collection}, photos, images, gallery, installation pictures, or site photos, share this image link.`,
    ].join(" ");
  }
  // PDF handled async in extractDocumentText
  if (mime.includes("pdf") || lower.endsWith(".pdf")) {
    return "";
  }
  return buffer.toString("utf8");
}

/** Prefer real PDF/DOCX text; fall back to catalogue stub so indexing never fails hard. */
async function extractDocumentText(
  buffer: Buffer,
  mimeType: string | null,
  fileName: string,
  options?: { title?: string; collectionName?: string },
): Promise<{ text: string; extractedFromPdf: boolean; isStub: boolean }> {
  const lower = fileName.toLowerCase();
  const mime = (mimeType || "").toLowerCase();
  const title = options?.title || fileName;
  const collection = options?.collectionName || "Knowledge Base";

  if (mime.includes("pdf") || lower.endsWith(".pdf")) {
    try {
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(buffer));
      const pages = Array.isArray(result.text) ? result.text : [String(result.text || "")];
      const pdfText = pages.join("\n").replace(/\s+/g, " ").trim();
      if (pdfText.length >= 80) {
        return {
          text: [
            `PDF: ${title}. Collection: ${collection}. File: ${fileName}.`,
            pdfText.slice(0, 120_000),
          ].join("\n\n"),
          extractedFromPdf: true,
          isStub: false,
        };
      }
    } catch (err) {
      console.warn("PDF text extraction failed; using stub metadata", fileName, err);
    }
    return {
      text: [
        `Knowledge PDF: ${title}.`,
        `Collection: ${collection}.`,
        `File name: ${fileName}.`,
        "This document is available for customer download.",
        "If the visitor asks for a catalogue, datasheet, brochure, or PDF, share the download link for this file.",
      ].join(" "),
      extractedFromPdf: false,
      isStub: true,
    };
  }

  if (isDocxFile(fileName, mimeType)) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      const docText = String(result.value || "").replace(/\s+/g, " ").trim();
      if (docText.length >= 40) {
        return {
          text: [
            `Word document: ${title}. Collection: ${collection}. File: ${fileName}.`,
            docText.slice(0, 120_000),
          ].join("\n\n"),
          extractedFromPdf: false,
          isStub: false,
        };
      }
    } catch (err) {
      console.warn("DOCX text extraction failed", fileName, err);
    }
    return {
      text: [
        `Knowledge document: ${title}.`,
        `Collection: ${collection}.`,
        `File name: ${fileName}.`,
        "This Word document is available for customer download.",
      ].join(" "),
      extractedFromPdf: false,
      isStub: true,
    };
  }

  return {
    text: extractTextFromBuffer(buffer, mimeType, fileName, options),
    extractedFromPdf: false,
    isStub: false,
  };
}

async function ensureKnowledgeBucket() {
  const supabase = createServiceSupabase();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(`Could not list storage buckets: ${listError.message}. Check SUPABASE_SERVICE_ROLE_KEY.`);
  }
  const exists = (buckets ?? []).some((b) => b.id === BUCKET || b.name === BUCKET);
  if (exists) return;

  const { error: createError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 15 * 1024 * 1024,
  });
  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(
      `Could not create storage bucket "${BUCKET}": ${createError.message}. Create it in Supabase → Storage, or re-run 004_knowledge_rag.sql.`,
    );
  }
}

async function refreshCollectionCounts(supabase: ReturnType<typeof createServiceSupabase>, collectionId: string) {
  const { count: docCount } = await supabase
    .from("knowledge_documents")
    .select("id", { count: "exact", head: true })
    .eq("collection_id", collectionId);
  const { count: totalChunks } = await supabase
    .from("knowledge_chunks")
    .select("id", { count: "exact", head: true })
    .eq("collection_id", collectionId);
  await supabase
    .from("knowledge_collections")
    .update({
      doc_count: docCount ?? 0,
      chunk_count: totalChunks ?? 0,
      status: "Indexed",
    })
    .eq("id", collectionId);
}

async function indexBuffer(options: {
  supabase: ReturnType<typeof createServiceSupabase>;
  orgId: string;
  documentId: string;
  collectionId: string;
  fileName: string;
  title: string;
  mimeType: string | null;
  buffer: Buffer;
  storagePath: string;
}) {
  const { supabase, orgId, documentId, collectionId, fileName, title, mimeType, buffer, storagePath } = options;
  const sourceUrl = publicFileUrl(storagePath);

  const { data: collection } = await supabase
    .from("knowledge_collections")
    .select("name")
    .eq("id", collectionId)
    .maybeSingle();
  const collectionName = (collection?.name as string | undefined) || "Knowledge Base";

  const { data: existingDoc } = await supabase
    .from("knowledge_documents")
    .select("metadata")
    .eq("id", documentId)
    .maybeSingle();
  const preservedTags = readDocTags(existingDoc?.metadata);
  const nextMeta: Record<string, unknown> = {
    fileName,
    kind: isImageFile(fileName, mimeType) ? "image" : "document",
  };
  if (preservedTags.length) nextMeta.tags = preservedTags;

  await supabase
    .from("knowledge_documents")
    .update({
      storage_path: storagePath,
      source_url: sourceUrl,
      status: "processing",
      mime_type: mimeType,
      metadata: nextMeta,
    })
    .eq("id", documentId);

  const { text, extractedFromPdf, isStub } = await extractDocumentText(buffer, mimeType, fileName, {
    title,
    collectionName,
  });
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error("No extractable text found in file");
  }

  const kind = isImageFile(fileName, mimeType) ? "image" : "document";
  if (extractedFromPdf) {
    nextMeta.pdf_text_extracted = true;
  } else if (
    kind === "document" &&
    ((mimeType || "").toLowerCase().includes("pdf") || fileName.toLowerCase().endsWith(".pdf"))
  ) {
    nextMeta.pdf_text_extracted = false;
  }
  if (isStub) nextMeta.index_stub = true;
  else delete nextMeta.index_stub;

  let embeddings: number[][];
  try {
    embeddings = await embedTexts(chunks);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Embedding failed";
    throw new Error(`${message}. Confirm OPENAI_API_KEY is set on the server.`);
  }

  const rows = chunks.map((content, index) => ({
    org_id: orgId,
    document_id: documentId,
    collection_id: collectionId,
    chunk_index: index,
    content,
    token_estimate: estimateTokens(content),
    embedding: toVectorLiteral(embeddings[index] ?? []),
    metadata: {
      fileName,
      title,
      collectionName,
      kind,
      stub: isStub,
    },
  }));

  await supabase.from("knowledge_chunks").delete().eq("document_id", documentId);
  const { error: chunkError } = await supabase.from("knowledge_chunks").insert(rows);
  if (chunkError) {
    throw new Error(
      `Could not save embeddings: ${chunkError.message}. If this mentions knowledge_chunks/vector, run supabase/migrations/004_knowledge_rag.sql.`,
    );
  }

  await supabase
    .from("knowledge_documents")
    .update({ status: "ready", chunk_count: rows.length, metadata: nextMeta })
    .eq("id", documentId);

  await refreshCollectionCounts(supabase, collectionId);

  return {
    id: documentId,
    status: "ready" as const,
    chunk_count: rows.length,
    download_url: sourceUrl,
    storage_path: storagePath,
  };
}

export const ensureKnowledgeStorage = createServerFn({ method: "POST" }).handler(async () => {
  await ensureKnowledgeBucket();
  return { ok: true, bucket: BUCKET };
});

export const listKnowledgeCollections = createServerFn({ method: "GET" }).handler(async () => {
  const orgId = await requireStaffOrgId();
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("knowledge_collections")
    .select("*")
    .eq("org_id", orgId)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const listKnowledgeDocuments = createServerFn({ method: "POST" })
  .validator(z.object({ collectionId: z.string().uuid().optional() }))
  .handler(async ({ data }) => {
    const orgId = await requireStaffOrgId();
    const supabase = createServiceSupabase();
    let q = supabase
      .from("knowledge_documents")
      .select("*, collection:knowledge_collections(id, name)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.collectionId) q = q.eq("collection_id", data.collectionId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((row) => ({
      ...row,
      download_url: row.storage_path ? publicFileUrl(row.storage_path as string) : row.source_url,
    }));
  });

export const createKnowledgeCollection = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(500).optional(),
      purpose: z
        .enum(["datasheets", "site_photos", "policies", "faqs", "other"])
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    const orgId = await requireStaffOrgId();
    const supabase = createServiceSupabase();
    const { data: created, error } = await supabase
      .from("knowledge_collections")
      .insert({
        org_id: orgId,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        purpose: data.purpose || null,
        status: "Indexed",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return created;
  });

export const updateKnowledgeCollection = createServerFn({ method: "POST" })
  .validator(
    z.object({
      collectionId: z.string().uuid(),
      description: z.string().max(500).optional(),
      purpose: z
        .enum(["datasheets", "site_photos", "policies", "faqs", "other"])
        .nullable()
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const patch: Record<string, unknown> = {};
    if (data.description !== undefined) patch.description = data.description.trim() || null;
    if (data.purpose !== undefined) patch.purpose = data.purpose;
    if (!Object.keys(patch).length) return { ok: true };
    const orgId = await requireStaffOrgId();
    const { error } = await supabase
      .from("knowledge_collections")
      .update(patch)
      .eq("id", data.collectionId)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Re-index one document already in Storage (refresh PDF text + embeddings). */
export const reindexKnowledgeDocument = createServerFn({ method: "POST" })
  .validator(z.object({ documentId: z.string().uuid() }))
  .handler(async ({ data }) => indexDocumentById(data.documentId));

/** Re-index every document in a collection that has a storage_path. */
export const reindexKnowledgeCollection = createServerFn({ method: "POST" })
  .validator(z.object({ collectionId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const orgId = await requireStaffOrgId();
    const supabase = createServiceSupabase();
    const { data: docs, error } = await supabase
      .from("knowledge_documents")
      .select("id, title, storage_path")
      .eq("org_id", orgId)
      .eq("collection_id", data.collectionId)
      .not("storage_path", "is", null)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    let ok = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const doc of docs ?? []) {
      try {
        await indexDocumentById(String(doc.id));
        ok += 1;
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : "Indexing failed";
        errors.push(`${String(doc.title || doc.id).slice(0, 40)}: ${msg}`);
      }
    }
    return { ok, failed, total: (docs ?? []).length, errors: errors.slice(0, 8) };
  });

async function prepareUploadRecord(data: {
  collectionId: string;
  title: string;
  fileName: string;
  mimeType?: string;
}) {
  assertSupportedFile(data.fileName, data.mimeType);
  await ensureKnowledgeBucket();

  const orgId = await requireStaffOrgId();
  const supabase = createServiceSupabase();
  const { data: collection, error: collectionError } = await supabase
    .from("knowledge_collections")
    .select("id")
    .eq("id", data.collectionId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (collectionError) throw new Error(collectionError.message);
  if (!collection) throw new Error("Collection not found");

  const { data: doc, error: docError } = await supabase
    .from("knowledge_documents")
    .insert({
      org_id: orgId,
      collection_id: data.collectionId,
      title: data.title.trim(),
      mime_type: data.mimeType || null,
      status: "pending",
      metadata: { fileName: data.fileName },
    })
    .select("*")
    .single();
  if (docError) throw new Error(docError.message);

  const safeName = data.fileName.replace(/[^\w.\-]+/g, "_");
  const storagePath = orgStoragePath(orgId, data.collectionId, doc.id, safeName);
  const sourceUrl = publicFileUrl(storagePath);

  await supabase
    .from("knowledge_documents")
    .update({ storage_path: storagePath, source_url: sourceUrl })
    .eq("id", doc.id);

  return {
    documentId: doc.id as string,
    collectionId: data.collectionId,
    storagePath,
    downloadUrl: sourceUrl,
    bucket: BUCKET,
  };
}

/** Creates a pending document row and returns the Storage path the client should upload to. */
export const prepareKnowledgeUpload = createServerFn({ method: "POST" })
  .validator(
    z.object({
      collectionId: z.string().uuid(),
      title: z.string().min(1).max(200),
      fileName: z.string().min(1).max(240),
      mimeType: z.string().max(120).optional(),
    }),
  )
  .handler(async ({ data }) => prepareUploadRecord(data));

async function indexDocumentById(documentId: string) {
  const supabase = createServiceSupabase();
  const { data: doc, error } = await supabase
    .from("knowledge_documents")
    .select("*")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc) throw new Error("Document not found");
  if (!doc.storage_path) throw new Error("Document has no storage_path");

  const { data: fileData, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(doc.storage_path as string);
  if (downloadError || !fileData) {
    throw new Error(
      `Could not download uploaded file from Storage: ${downloadError?.message || "missing file"}. Check the knowledge bucket exists and the file uploaded.`,
    );
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  const fileName =
    String((doc.metadata as { fileName?: string } | null)?.fileName || "document") || "document";

  try {
    return await indexBuffer({
      supabase,
      orgId: String(doc.org_id),
      documentId: doc.id as string,
      collectionId: doc.collection_id as string,
      fileName,
      title: doc.title as string,
      mimeType: (doc.mime_type as string | null) || null,
      buffer,
      storagePath: doc.storage_path as string,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Indexing failed";
    const tags = readDocTags(doc.metadata);
    await supabase
      .from("knowledge_documents")
      .update({
        status: "failed",
        metadata: {
          fileName,
          error: message,
          ...(tags.length ? { tags } : {}),
        },
      })
      .eq("id", doc.id);
    throw new Error(message);
  }
}

/** Indexes a document already uploaded to Storage. */
export const indexKnowledgeDocument = createServerFn({ method: "POST" })
  .validator(z.object({ documentId: z.string().uuid() }))
  .handler(async ({ data }) => indexDocumentById(data.documentId));

async function uploadBytesToPreparedDocument(options: {
  documentId: string;
  mimeType?: string;
  base64: string;
}) {
  await ensureKnowledgeBucket();
  const supabase = createServiceSupabase();
  const buffer = Buffer.from(options.base64, "base64");
  if (buffer.byteLength > 12 * 1024 * 1024) {
    throw new Error("File too large (max 12 MB).");
  }

  const orgId = await requireStaffOrgId();
  const { data: doc, error } = await supabase
    .from("knowledge_documents")
    .select("id, storage_path, metadata")
    .eq("id", options.documentId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc?.storage_path) throw new Error("Prepared document missing storage_path");
  const storagePath = assertOrgStoragePath(String(doc.storage_path), orgId);

  const fileName =
    String((doc.metadata as { fileName?: string } | null)?.fileName || "document") || "document";

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: options.mimeType || "application/octet-stream",
    upsert: true,
  });
  if (uploadError) {
    const tags = readDocTags(doc.metadata);
    await supabase
      .from("knowledge_documents")
      .update({
        status: "failed",
        metadata: {
          fileName,
          error: uploadError.message,
          ...(tags.length ? { tags } : {}),
        },
      })
      .eq("id", doc.id);
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  return indexDocumentById(doc.id as string);
}

/**
 * Service-role upload into an already-prepared document path, then index.
 * Used when browser → Storage is blocked by RLS/policies.
 */
export const uploadPreparedKnowledgeDocument = createServerFn({ method: "POST" })
  .validator(
    z.object({
      documentId: z.string().uuid(),
      mimeType: z.string().max(120).optional(),
      base64: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => uploadBytesToPreparedDocument(data));

/**
 * Fallback for small files: server uploads + indexes in one step.
 * Prefer prepareKnowledgeUpload + browser Storage upload for PDFs.
 */
export const uploadKnowledgeDocument = createServerFn({ method: "POST" })
  .validator(
    z.object({
      collectionId: z.string().uuid(),
      title: z.string().min(1).max(200),
      fileName: z.string().min(1).max(240),
      mimeType: z.string().max(120).optional(),
      base64: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    assertSupportedFile(data.fileName, data.mimeType);

    const buffer = Buffer.from(data.base64, "base64");
    if (buffer.byteLength > 8 * 1024 * 1024) {
      throw new Error("File too large for server upload (max 8 MB). Try again — large files should use Storage upload.");
    }

    const prepared = await prepareUploadRecord({
      collectionId: data.collectionId,
      title: data.title,
      fileName: data.fileName,
      mimeType: data.mimeType,
    });

    return uploadBytesToPreparedDocument({
      documentId: prepared.documentId,
      mimeType: data.mimeType,
      base64: data.base64,
    });
  });

export const deleteKnowledgeDocument = createServerFn({ method: "POST" })
  .validator(z.object({ documentId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const orgId = await requireStaffOrgId();
    const supabase = createServiceSupabase();
    const { data: doc, error } = await supabase
      .from("knowledge_documents")
      .select("*")
      .eq("id", data.documentId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) throw new Error("Document not found");

    if (doc.storage_path) {
      const path = assertOrgStoragePath(String(doc.storage_path), orgId);
      await supabase.storage.from(BUCKET).remove([path]);
    }
    const { error: delError } = await supabase.from("knowledge_documents").delete().eq("id", data.documentId);
    if (delError) throw new Error(delError.message);

    await refreshCollectionCounts(supabase, doc.collection_id as string);
    return { ok: true };
  });

/** Set free-form tags on a knowledge document (e.g. state Maharashtra). Preserves other metadata. */
export const updateKnowledgeDocumentTags = createServerFn({ method: "POST" })
  .validator(
    z.object({
      documentId: z.string().uuid(),
      tags: z.array(z.string().max(40)).max(20),
    }),
  )
  .handler(async ({ data }) => {
    const orgId = await requireStaffOrgId();
    const supabase = createServiceSupabase();
    const { data: doc, error } = await supabase
      .from("knowledge_documents")
      .select("id, metadata")
      .eq("id", data.documentId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) throw new Error("Document not found");

    const prev = (doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {}) as Record<
      string,
      unknown
    >;
    const tags = normalizeKnowledgeTags(data.tags);
    const nextMeta: Record<string, unknown> = { ...prev };
    if (tags.length) nextMeta.tags = tags;
    else delete nextMeta.tags;

    const { error: updError } = await supabase
      .from("knowledge_documents")
      .update({ metadata: nextMeta, updated_at: new Date().toISOString() })
      .eq("id", data.documentId)
      .eq("org_id", orgId);
    if (updError) throw new Error(updError.message);
    return { ok: true, tags };
  });

export type RetrievedChunk = {
  content: string;
  similarity: number;
  document_title: string;
  source_url: string | null;
  storage_path: string | null;
  download_url: string | null;
  document_id?: string | null;
  collection_id?: string | null;
  kind?: string | null;
  stub?: boolean;
};

const STORAGE_URL_RE =
  /https?:\/\/[^\s)\]>"']+\/storage\/v1\/object\/public\/knowledge\/[^\s)\]>"']+/gi;

function queryKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9.+]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !/^(the|and|for|with|from|that|this|have|what|which|about|please|need|want)$/i.test(w))
    .slice(0, 12);
}

function keywordBoost(content: string, title: string, keywords: string[]): number {
  if (!keywords.length) return 0;
  const hay = `${title}\n${content}`.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (hay.includes(kw)) hits += 1;
  }
  return Math.min(0.18, hits * 0.035);
}

function chunkMeta(row: Record<string, unknown>): {
  kind: string | null;
  stub: boolean;
  fileName: string;
} {
  const meta =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    kind: typeof meta.kind === "string" ? meta.kind : null,
    stub: meta.stub === true,
    fileName: typeof meta.fileName === "string" ? meta.fileName : "",
  };
}

function isPdfChunk(options: {
  kind?: string | null;
  title: string;
  fileName?: string;
  storagePath?: string | null;
}): boolean {
  if (options.kind === "image") return false;
  const hay = `${options.title} ${options.fileName || ""} ${options.storagePath || ""}`.toLowerCase();
  return hay.includes(".pdf") || /\.pdf(\?|#|$)/i.test(hay);
}

/** Shared prompt formatting for all channels — title + score + content. */
export function formatKnowledgeContext(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return "";
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] (${c.document_title}, relevance ${c.similarity.toFixed(2)})\n${c.content}`,
    )
    .join("\n\n")
    .replace(STORAGE_URL_RE, "[file]");
}

/** Verified download links from retrieved chunks — PDFs only (never mislabel photos as .pdf). */
export function downloadLinksFromChunks(
  chunks: RetrievedChunk[],
  max = 4,
): Array<{ title: string; url: string; fileName?: string }> {
  const seen = new Set<string>();
  const out: Array<{ title: string; url: string; fileName?: string }> = [];
  for (const c of chunks) {
    if (c.kind === "image" || c.stub) continue;
    if (
      !isPdfChunk({
        kind: c.kind,
        title: c.document_title,
        storagePath: c.storage_path,
      })
    ) {
      continue;
    }
    const url = (c.download_url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = c.document_title || "document.pdf";
    const label = title.toLowerCase().endsWith(".pdf") ? title : `${title}.pdf`;
    out.push({
      title: label,
      url,
      fileName: label,
    });
    if (out.length >= max) break;
  }
  return out;
}

export function knowledgeIsUseful(chunks: RetrievedChunk[]): boolean {
  if (!chunks.length) return false;
  const substantive = chunks.filter((c) => c.kind !== "image" && !c.stub);
  const pool = substantive.length ? substantive : chunks;
  const top = Math.max(...pool.map((c) => c.similarity));
  return top >= 0.58 || pool.some((c) => c.content.length > 120 && c.similarity >= 0.52);
}

/**
 * Hybrid retrieval: vector search (wider pool) + keyword boost re-rank → top-k.
 * Demotes image stubs and filename-only PDF stubs for Q&A grounding.
 * On failure returns [] (callers should treat as ungrounded).
 */
export async function retrieveKnowledgeContext(
  query: string,
  limit = 6,
  options?: { collectionIds?: string[]; orgId: string },
): Promise<RetrievedChunk[]> {
  const orgId = options?.orgId;
  if (!orgId) throw new Error("orgId is required for knowledge retrieval");
  const supabase = createServiceSupabase();
  const keywords = queryKeywords(query);
  const fetchCount = Math.min(24, Math.max(limit * 3, limit + 4));
  try {
    const embedding = await embedQuery(query);
    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: toVectorLiteral(embedding),
      match_org_id: orgId,
      match_count: fetchCount,
      match_threshold: 0.48,
    });
    if (error) throw new Error(error.message);
    const mapped: RetrievedChunk[] = [];
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const longUrl = row.storage_path
        ? publicFileUrl(String(row.storage_path))
        : (row.source_url as string) || null;
      const docId = row.document_id ? String(row.document_id) : "";
      const docTitle = String(row.document_title ?? "Document");
      const meta = chunkMeta(row);
      const shortFromDoc = docId
        ? shortDatasheetUrl(docId, docTitle, meta.fileName || null, orgId)
        : null;
      const content = String(row.content ?? "");
      const baseSim = Number(row.similarity ?? 0);
      let boosted = Math.min(0.99, baseSim + keywordBoost(content, docTitle, keywords));
      // Prefer real document text over image caption stubs / filename-only PDF stubs
      if (meta.kind === "image") boosted -= 0.08;
      if (meta.stub) boosted -= 0.12;
      mapped.push({
        content,
        similarity: Math.max(0, boosted),
        document_title: docTitle,
        source_url: (row.source_url as string) || null,
        storage_path: (row.storage_path as string) || null,
        download_url: shortFromDoc || (longUrl ? await shortenStorageUrl(longUrl) : null),
        document_id: docId || null,
        collection_id: row.collection_id ? String(row.collection_id) : null,
        kind: meta.kind,
        stub: meta.stub,
      });
    }
    mapped.sort((a, b) => b.similarity - a.similarity);
    const allow = (options?.collectionIds || []).filter(Boolean);
    const scoped = allow.length
      ? mapped.filter((c) => c.collection_id && allow.includes(c.collection_id))
      : mapped;
    const pool = scoped.length ? scoped : mapped;
    const top = pool.slice(0, limit);
    if (!top.length) {
      console.warn("Knowledge retrieval: zero chunks above threshold", { query: query.slice(0, 80) });
    }
    return top;
  } catch (err) {
    console.error("Knowledge retrieval failed", err);
    return [];
  }
}

export type CatalogueDownload = {
  /** Customer-facing label, e.g. "E Series Solar Hybrid Inverter.pdf" */
  title: string;
  url: string;
  fileName: string;
  documentId?: string;
  collection?: string;
};

export type CatalogueClarifyOption = {
  label: string;
  documentId: string;
  title: string;
  url: string;
  fileName: string;
};

export type CatalogueSearchResult = {
  /** match = send one PDF; clarify = ask which; none = not a catalogue ask / no files */
  mode: "match" | "clarify" | "none";
  downloads: CatalogueDownload[];
  clarifyOptions: CatalogueClarifyOption[];
  /** Short customer-facing text (options list or empty) */
  message: string;
  /** True when match came from a prior numbered/name pick — keep the list for another pick */
  fromPending?: boolean;
};

type DatasheetRow = {
  id: string;
  title: string;
  fileName: string;
  label: string;
  url: string;
  collection: string;
  hay: string;
};

/** Product families → aliases customers type on WhatsApp / chat. */
const PRODUCT_FAMILIES: Array<{
  id: string;
  label: string;
  /** Customer said one of these */
  ask: RegExp;
  /** Datasheet title/filename matches */
  doc: RegExp;
}> = [
  {
    id: "ongrid",
    label: "OnGrid Inverter",
    ask: /\b(ongrid|on[\s-]?grid|grid[\s-]?tied?|grid[\s-]?tie)\b/i,
    doc: /ongrid|on[\s-]?grid/i,
  },
  {
    id: "bess",
    label: "BESS",
    ask: /\bbess\b|battery\s*energy|energy\s*storage|battery\s*storage/i,
    doc: /\bbess\b/i,
  },
  {
    id: "charger",
    label: "Battery Charger",
    ask: /battery\s*charger|\bcharger\b/i,
    doc: /battery\s*charger|charger/i,
  },
  {
    id: "sfc",
    label: "Static Frequency Converter",
    ask: /\bsfc\b|frequency\s*converter|static\s*frequency/i,
    doc: /sfc|frequency\s*converter|static\s*frequency/i,
  },
  {
    id: "industrial",
    label: "Industrial Inverter",
    ask: /industrial\s*inverter/i,
    doc: /industrial\s*inverter/i,
  },
  {
    id: "eseries",
    label: "E-Series Solar Hybrid Inverter",
    ask: /\be[\s-]?series\b/i,
    doc: /e[\s-]?series/i,
  },
  {
    id: "1ph",
    label: "1PH Solar Hybrid Inverter",
    ask: /\b1\s*ph\b|\b1ph\b|single[\s-]?phase|reefi\s*5/i,
    doc: /1ph|1\s*ph|single|reefi.*5|5kva\s*to\s*40/i,
  },
  {
    id: "3ph-large",
    label: "10KW–125KW 3PH Solar Hybrid Inverter",
    ask: /10\s*kw|125\s*kw|10kw|125kw|10\s*to\s*125/i,
    doc: /10kw|125kw|10\s*kw|125|10kw\s*to\s*125/i,
  },
  {
    id: "3ph",
    label: "3PH Solar Hybrid Inverter",
    ask: /\b3\s*ph\b|\b3ph\b|three[\s-]?phase|reefi\s*3/i,
    doc: /3ph|3\s*ph|three|reefi.*3p|3p_/i,
  },
  {
    id: "hybrid",
    label: "Solar Hybrid Inverter",
    ask: /solar\s*hybrid|hybrid\s*inverter|\bhybrid\b/i,
    doc: /hybrid|solar/i,
  },
];

const CATALOGUE_INTENT_RE =
  /pdf|catalogue|catalog|datasheet|brochure|spec\s*sheet|manual|price\s*list|specification|download/i;

const STOP_WORDS = new Set([
  "pdf",
  "catalogue",
  "catalog",
  "catalogues",
  "datasheet",
  "datasheets",
  "brochure",
  "download",
  "downloads",
  "spec",
  "sheet",
  "manual",
  "want",
  "wanting",
  "please",
  "send",
  "share",
  "with",
  "from",
  "the",
  "and",
  "our",
  "for",
  "you",
  "can",
  "help",
  "need",
  "links",
  "link",
  "file",
  "files",
  "me",
  "this",
  "that",
  "product",
  "products",
  "enertech",
  "give",
]);

function shortClarifyLabel(title: string, fileName: string): string {
  const raw = String(title || fileName || "Datasheet")
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return raw.slice(0, 60) || "Datasheet";
}

function buildClarifyMessage(options: CatalogueClarifyOption[]): string {
  const lines = options.map((o, i) => `${i + 1}. ${o.label}`);
  return `Which catalogue do you need?\n${lines.join("\n")}\n\nReply with the number or product name.`;
}

async function loadDatasheetRows(orgId: string): Promise<DatasheetRow[]> {
  const supabase = createServiceSupabase();
  const { data: docs } = await supabase
    .from("knowledge_documents")
    .select(
      "id, title, source_url, storage_path, mime_type, metadata, collection:knowledge_collections(name, purpose)",
    )
    .eq("org_id", orgId)
    .eq("status", "ready")
    .order("updated_at", { ascending: false })
    .limit(80);

  const rows: DatasheetRow[] = [];
  for (const doc of docs ?? []) {
    const mime = (doc.mime_type as string | null) || "";
    const fileName = String((doc.metadata as { fileName?: string } | null)?.fileName || "");
    const collectionRel = doc.collection as
      | { name?: string; purpose?: string }
      | { name?: string; purpose?: string }[]
      | null;
    const collection = Array.isArray(collectionRel) ? collectionRel[0] : collectionRel;
    const collectionName = String(collection?.name || "");
    const purpose = String(collection?.purpose || "").toLowerCase();
    const isDatasheetCollection =
      purpose === "datasheets" ||
      /datasheet|catalogue|catalog|brochure|spec\s*sheet/i.test(collectionName);
    if (!isDatasheetCollection) continue;

    const isPdf =
      mime.includes("pdf") ||
      fileName.toLowerCase().endsWith(".pdf") ||
      /\.pdf$/i.test(String(doc.title || ""));
    if (!isPdf || !doc.id) continue;

    const label = ensurePdfFileLabel(String(doc.title || "datasheet"), fileName || null);
    const url = shortDatasheetUrl(
      String(doc.id),
      String(doc.title || label),
      fileName || label,
      orgId,
    );
    if (!url || !/^https?:\/\//i.test(url)) continue;

    rows.push({
      id: String(doc.id),
      title: String(doc.title || label),
      fileName: label,
      label,
      url,
      collection: collectionName || "Datasheets",
      hay: `${doc.title} ${fileName} ${collectionName} ${label}`.toLowerCase(),
    });
  }
  return rows;
}

function scoreDatasheet(row: DatasheetRow, query: string, tokens: string[]): number {
  let score = 0;
  const q = query.toLowerCase();

  for (const family of PRODUCT_FAMILIES) {
    if (family.ask.test(q) && family.doc.test(row.hay)) {
      score += family.id === "hybrid" ? 25 : 50;
    }
  }

  for (const t of tokens) {
    if (row.hay.includes(t)) score += 10;
  }

  // Strong exact-ish title hits
  const titleLower = row.title.toLowerCase();
  if (tokens.some((t) => t.length >= 4 && titleLower.includes(t))) score += 15;

  return score;
}

function toDownload(row: DatasheetRow): CatalogueDownload {
  return {
    title: row.label,
    fileName: row.label,
    url: row.url,
    documentId: row.id,
    collection: row.collection,
  };
}

function toClarifyOption(row: DatasheetRow): CatalogueClarifyOption {
  return {
    label: shortClarifyLabel(row.title, row.fileName),
    documentId: row.id,
    title: row.label,
    url: row.url,
    fileName: row.label,
  };
}

/**
 * Resolve a numbered / named reply after we asked "Which catalogue…".
 * Returns a single match when the customer picks an option.
 */
export function resolveCatalogueChoice(
  query: string,
  pending: Array<{ documentId: string; label: string; title?: string; url?: string; fileName?: string }>,
  opts?: { numbersAndLabelsOnly?: boolean },
): CatalogueSearchResult | null {
  if (!pending.length) return null;
  const q = query.trim().toLowerCase();
  if (!q) return null;

  // Definition questions must never resolve a pending PDF pick
  if (isEducateOnlyAsk(q)) return null;

  const num = q.match(/^(\d{1,2})\b/);
  if (num) {
    const idx = Number(num[1]) - 1;
    const pick = pending[idx];
    if (pick?.documentId && pick.url) {
      const title = pick.fileName || pick.title || `${pick.label}.pdf`;
      return {
        mode: "match",
        downloads: [
          {
            title,
            fileName: title,
            url: pick.url,
            documentId: pick.documentId,
          },
        ],
        clarifyOptions: [],
        message: "Here is the catalogue.",
        fromPending: true,
      };
    }
  }

  // Match by label / title text (require real tokens — empty [].every() is always true in JS)
  const tokens = q.split(/\s+/).filter((w) => w.length > 2);
  if (q.length >= 3) {
    const hit = pending.find((p) => {
      const hay = `${p.label} ${p.title || ""}`.toLowerCase();
      if (hay.includes(q) && q.length >= 3) return true;
      return tokens.length > 0 && tokens.every((w) => hay.includes(w));
    });
    if (hit?.documentId && hit.url) {
      const title = hit.fileName || hit.title || `${hit.label}.pdf`;
      return {
        mode: "match",
        downloads: [
          {
            title,
            fileName: title,
            url: hit.url,
            documentId: hit.documentId,
          },
        ],
        clarifyOptions: [],
        message: "Here is the catalogue.",
        fromPending: true,
      };
    }
  }

  if (opts?.numbersAndLabelsOnly) return null;

  // Soft: family alias against pending labels (prefer best label match, not first)
  for (const family of PRODUCT_FAMILIES) {
    if (!family.ask.test(q)) continue;
    // Require catalogue-ish intent for soft family pick when message is long
    if (q.length > 28 && !/catalog|catalogue|pdf|datasheet|brochure|send|share/i.test(q)) {
      continue;
    }
    const candidates = pending.filter((p) => family.doc.test(`${p.label} ${p.title || ""}`));
    if (!candidates.length) continue;
    const famHit =
      candidates.find((p) => {
        const hay = `${p.label} ${p.title || ""}`.toLowerCase();
        if (family.id === "3ph") return /^3\s*ph\b/i.test(p.label) && !/10\s*kw|125/i.test(hay);
        if (family.id === "1ph") return /^1\s*ph\b/i.test(p.label);
        return true;
      }) || candidates[0];
    if (famHit?.documentId && famHit.url) {
      const title = famHit.fileName || famHit.title || `${famHit.label}.pdf`;
      return {
        mode: "match",
        downloads: [
          {
            title,
            fileName: title,
            url: famHit.url,
            documentId: famHit.documentId,
          },
        ],
        clarifyOptions: [],
        message: "Here is the catalogue.",
        fromPending: true,
      };
    }
  }

  return null;
}

/**
 * Smart catalogue resolve:
 * - Specific product (e.g. ongrid) → exactly one PDF
 * - Vague (catalogue / inverter) → ask which, list options, send nothing yet
 * - Never dump all datasheets
 */
export async function resolveCatalogueRequest(
  query: string,
  options?: {
    orgId: string;
    pendingOptions?: Array<{
      documentId: string;
      label: string;
      title?: string;
      url?: string;
      fileName?: string;
    }>;
  },
): Promise<CatalogueSearchResult> {
  const q = String(query || "").trim();
  if (!q) {
    return { mode: "none", downloads: [], clarifyOptions: [], message: "" };
  }
  if (!options?.orgId) {
    return { mode: "none", downloads: [], clarifyOptions: [], message: "" };
  }

  // Never treat ok/thanks/hi as a catalogue pick
  if (isAckOnlyMessage(q) || isGreetingOnlyMessage(q)) {
    return { mode: "none", downloads: [], clarifyOptions: [], message: "" };
  }

  // Service / fault asks must not pull a pending catalogue PDF
  const pureNumberPick = /^\d{1,2}$/.test(q);
  if (isServiceIntent(q) && !pureNumberPick) {
    return { mode: "none", downloads: [], clarifyOptions: [], message: "" };
  }

  // "What is solar hybrid…" must explain — never auto-send catalogue / pending pick
  if (isEducateOnlyAsk(q)) {
    return { mode: "none", downloads: [], clarifyOptions: [], message: "" };
  }

  // Follow-up after we listed options
  if (options?.pendingOptions?.length) {
    // Soft family match only when NOT a service ask (already gated) and not vague noise
    const choice = resolveCatalogueChoice(q, options.pendingOptions, {
      numbersAndLabelsOnly: false,
    });
    if (choice) return choice;
    // Number outside the list — keep the same options visible
    if (/^\d{1,2}$/.test(q)) {
      const clarifyOptions: CatalogueClarifyOption[] = options.pendingOptions.map((p) => ({
        label: p.label,
        documentId: p.documentId,
        title: p.title || p.label,
        url: p.url || "",
        fileName: p.fileName || p.title || `${p.label}.pdf`,
      }));
      return {
        mode: "clarify",
        downloads: [],
        clarifyOptions,
        message: buildClarifyMessage(clarifyOptions),
      };
    }
  }

  const wantsCatalogue =
    CATALOGUE_INTENT_RE.test(q) ||
    PRODUCT_FAMILIES.some((f) => f.ask.test(q) && /\b(pdf|catalogue|catalog|datasheet|brochure|send|share|want|need|give)\b/i.test(q));

  // Product name alone after pending clarify already handled; bare "ongrid" without catalogue words
  // still counts when they clearly name a family + send/share intent OR just the product after asking.
  // Do NOT treat pending+family alone as catalogue — that hijacks "what is hybrid" after an old clarify list.
  const namedFamily = PRODUCT_FAMILIES.find((f) => f.ask.test(q));
  const isCatalogueAsk =
    CATALOGUE_INTENT_RE.test(q) ||
    (Boolean(namedFamily) &&
      /\b(send|share|want|need|give|pdf|catalogue|catalog|datasheet|brochure)\b/i.test(q));

  if (!isCatalogueAsk && !wantsCatalogue) {
    return { mode: "none", downloads: [], clarifyOptions: [], message: "" };
  }

  const rows = await loadDatasheetRows(options.orgId);
  if (rows.length === 0) {
    return { mode: "none", downloads: [], clarifyOptions: [], message: "" };
  }

  const tokens = q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  const scored = rows
    .map((row) => ({ row, score: scoreDatasheet(row, q, tokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title));

  const specificFamily = PRODUCT_FAMILIES.find(
    (f) => f.ask.test(q) && f.id !== "hybrid",
  );
  const broadOnly =
    !specificFamily &&
    (tokens.length === 0 ||
      (tokens.length === 1 && ["inverter", "inverters", "solar", "ups"].includes(tokens[0]!)) ||
      (/hybrid/i.test(q) && !/\b(1\s*ph|1ph|3\s*ph|3ph|e[\s-]?series|10\s*kw|125)/i.test(q)));

  // Vague ask → list options, do not attach PDFs
  if (broadOnly || scored.length === 0) {
    const pool =
      scored.length > 0
        ? scored.map((s) => s.row)
        : /hybrid|inverter|solar/i.test(q)
          ? rows.filter((r) => /hybrid|inverter|solar|ongrid|bess/i.test(r.hay))
          : rows;
    const clarifyOptions = pool.map(toClarifyOption).slice(0, 9);
    // Deduplicate by label
    const seen = new Set<string>();
    const unique = clarifyOptions.filter((o) => {
      const k = o.label.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (unique.length === 1) {
      const only = pool[0]!;
      return {
        mode: "match",
        downloads: [toDownload(only)],
        clarifyOptions: [],
        message: "Here is the catalogue.",
      };
    }
    return {
      mode: "clarify",
      downloads: [],
      clarifyOptions: unique,
      message: buildClarifyMessage(unique),
    };
  }

  const top = scored[0]!;
  const second = scored[1];
  const clearWinner =
    top.score >= 40 ||
    (top.score >= 25 && (!second || top.score - second.score >= 15)) ||
    (specificFamily && top.score >= 25);

  if (clearWinner) {
    return {
      mode: "match",
      downloads: [toDownload(top.row)],
      clarifyOptions: [],
      message: "Here is the catalogue.",
    };
  }

  // Several similar scores → ask which
  const near = scored.filter((s) => s.score >= top.score - 10).map((s) => s.row);
  const clarifyOptions = near.map(toClarifyOption).slice(0, 9);
  if (clarifyOptions.length <= 1) {
    return {
      mode: "match",
      downloads: [toDownload(top.row)],
      clarifyOptions: [],
      message: "Here is the catalogue.",
    };
  }
  return {
    mode: "clarify",
    downloads: [],
    clarifyOptions,
    message: buildClarifyMessage(clarifyOptions),
  };
}

/** @deprecated Prefer resolveCatalogueRequest — returns at most one matched PDF (never dumps all). */
export async function findCatalogueDownloads(query: string, orgId: string): Promise<CatalogueDownload[]> {
  const result = await resolveCatalogueRequest(query, { orgId });
  return result.downloads;
}

export type ReferenceImage = {
  documentId: string;
  title: string;
  collection: string;
  /** Public HTTPS Storage URL (safe for WhatsApp image.link). */
  imageUrl: string;
  mimeType: string;
  fileName: string;
};

/** Short customer-facing line when sharing installation / application photos. */
export const REFERENCE_PHOTOS_REPLY = "Sir, here are some reference photos.";

/** Max reference photos per ask unless customer explicitly asks for more. */
export const REFERENCE_PHOTOS_LIMIT = 3;

export function customerAskedForMorePhotos(query: string): boolean {
  if (isEducateOnlyAsk(query)) return false;
  return /\b(more|all|extra|additional|aur|zyada|sab)\b/i.test(query);
}

/** Hindi/English cues that the visitor wants installation / application / product photos. */
export function wantsReferenceImages(query: string): boolean {
  return wantsSiteInstallOrReferencePhotos(query);
}

/** True when a ready PDF was indexed without extracted body text (filename stub). */
export function isPdfStubDocument(doc: {
  mime_type?: string | null;
  title?: string | null;
  metadata?: { fileName?: string; kind?: string; pdf_text_extracted?: boolean; index_stub?: boolean } | null;
}): boolean {
  if (doc.metadata?.kind === "image") return false;
  const mime = String(doc.mime_type || "").toLowerCase();
  const name = String(doc.metadata?.fileName || doc.title || "").toLowerCase();
  const isPdf = mime.includes("pdf") || name.endsWith(".pdf");
  if (!isPdf) return false;
  if (doc.metadata?.index_stub === true) return true;
  return doc.metadata?.pdf_text_extracted !== true;
}

const COLLECTION_ALIASES: Array<{ match: RegExp; boost: string }> = [
  { match: /cold\s*storage|coldstore|cold\s*room|freezer|cold\s*chain/, boost: "cold" },
  { match: /petrol|fuel\s*station|filling\s*station|petrol\s*pump/, boost: "petrol" },
  { match: /hospital|clinic|medical|healthcare|icu/, boost: "hospital" },
  { match: /fire\s*(safety|ref|install|system|fighting)?|sprinkler/, boost: "fire" },
  { match: /poultry|broiler|chicken\s*farm|hatchery/, boost: "poultry" },
  { match: /farm\s*house|farmhouse|house\/farm|residential|bungalow|villa/, boost: "house" },
  { match: /data\s*cent(?:er|re)|server\s*room/, boost: "data" },
  { match: /mall|retail|shop|store/, boost: "mall" },
  { match: /factory|industry|industrial|plant/, boost: "industr" },
  { match: /hotel|resort/, boost: "hotel" },
  { match: /bank|atm/, boost: "bank" },
  { match: /school|college|university|campus/, boost: "school" },
];

function scoreTagMatches(query: string, tags: string[]): number {
  const q = query.toLowerCase();
  let score = 0;
  for (const tag of tags) {
    const t = tag.toLowerCase().trim();
    if (t.length < 2) continue;
    if (q.includes(t)) {
      score += 18;
      continue;
    }
    const parts = t.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (parts.length > 1 && parts.every((p) => q.includes(p))) {
      score += 16;
    }
  }
  return score;
}

function scoreReferenceDoc(options: {
  query: string;
  title: string;
  fileName: string;
  collectionName: string;
  tags?: string[];
}): number {
  const q = options.query.toLowerCase();
  const tags = options.tags || [];
  const tagHay = tags.join(" ").toLowerCase();
  const hay = `${options.title} ${options.fileName} ${options.collectionName} ${tagHay}`.toLowerCase();
  let score = 0;

  const tokens = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  for (const w of tokens) {
    if (hay.includes(w)) score += 2;
    if (options.collectionName.toLowerCase().includes(w)) score += 3;
  }

  for (const alias of COLLECTION_ALIASES) {
    if (alias.match.test(q) && options.collectionName.toLowerCase().includes(alias.boost)) {
      score += 8;
    }
    if (alias.match.test(q) && hay.includes(alias.boost)) {
      score += 3;
    }
  }

  score += scoreTagMatches(q, tags);

  // Soft boost for install/reference intent even without exact collection name
  if (/install|reference|refrence|gallery|site\s*photo|dikhao/.test(q)) score += 1;

  return score;
}

/**
 * Find ready knowledge-base images for application / installation references.
 * Prefers collections whose names match the ask (Cold Storage, Petrol Pump, Hospital, …).
 */
export async function findReferenceImages(
  query: string,
  limit = REFERENCE_PHOTOS_LIMIT,
  options?: {
    orgId: string;
    excludeDocumentIds?: string[];
    preferCollection?: string | null;
  },
): Promise<ReferenceImage[]> {
  if (!options?.orgId) return [];
  if (isEducateOnlyAsk(query)) return [];
  const askingMore = customerAskedForMorePhotos(query);
  const prefer = String(options?.preferCollection || "").trim();
  const hasPrefer = prefer.length > 0;
  if (!wantsReferenceImages(query) && !(askingMore && hasPrefer)) return [];
  const max = Math.min(
    Math.max(1, limit),
    askingMore || hasPrefer ? Math.max(REFERENCE_PHOTOS_LIMIT, limit) : REFERENCE_PHOTOS_LIMIT,
  );
  const exclude = new Set((options?.excludeDocumentIds || []).map((id) => String(id)));
  const preferLower = prefer.toLowerCase();

  const supabase = createServiceSupabase();
  const { data: docs, error } = await supabase
    .from("knowledge_documents")
    .select("id, title, source_url, storage_path, mime_type, metadata, collection:knowledge_collections(name)")
    .eq("org_id", options.orgId)
    .eq("status", "ready")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("findReferenceImages failed", error.message);
    return [];
  }

  const scored: Array<ReferenceImage & { score: number; tagBoost: number }> = [];

  for (const doc of docs ?? []) {
    if (exclude.has(String(doc.id))) continue;
    const mime = (doc.mime_type as string | null) || "";
    const meta = (doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {}) as {
      fileName?: string;
      kind?: string;
      tags?: unknown;
    };
    const fileName = String(meta.fileName || "");
    const kind = String(meta.kind || "");
    const tags = normalizeKnowledgeTags(meta.tags);
    const collectionRel = doc.collection as { name?: string } | { name?: string }[] | null;
    const collectionName = String(
      Array.isArray(collectionRel) ? collectionRel[0]?.name || "" : collectionRel?.name || "",
    );
    if (hasPrefer && !collectionName.toLowerCase().includes(preferLower)) continue;

    const isImage =
      kind === "image" || isImageFile(fileName, mime) || mime.startsWith("image/");
    if (!isImage) continue;
    if (!doc.id || !doc.storage_path) continue;
    const imageUrl = shortKnowledgeDocumentUrl(String(doc.id));
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
      console.warn(
        "findReferenceImages: skipping photo — set APP_URL / VITE_APP_URL to a public HTTPS origin so /d/{id} links work",
      );
      continue;
    }

    const scoreQuery = askingMore && hasPrefer ? prefer : query;
    const tagBoost = scoreTagMatches(scoreQuery.toLowerCase(), tags);
    let score = scoreReferenceDoc({
      query: scoreQuery,
      title: String(doc.title || ""),
      fileName,
      collectionName,
      tags,
    });
    if (hasPrefer && collectionName.toLowerCase().includes(preferLower)) score += 20;

    scored.push({
      documentId: String(doc.id),
      title: String(doc.title || fileName || "Reference photo"),
      collection: collectionName || "Knowledge Base",
      imageUrl,
      mimeType: mime || "image/jpeg",
      fileName: fileName || "reference.jpg",
      score,
      tagBoost,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const namedApp = COLLECTION_ALIASES.some((a) => a.match.test(query.toLowerCase()));
  const hasTagHit = scored.some((s) => s.tagBoost >= 15);
  const filtered = hasPrefer
    ? scored
    : namedApp || hasTagHit
      ? scored.filter((s) => s.score >= 5)
      : scored.filter((s) => s.score >= 1);
  // When visitor named a tagged place, prefer tagged hits; fall back to untagged only if none
  const tagPreferred =
    !hasPrefer && hasTagHit ? scored.filter((s) => s.tagBoost >= 15 && s.score >= 5) : [];
  const pool =
    tagPreferred.length > 0 ? tagPreferred : filtered.length > 0 ? filtered : scored;

  const seen = new Set<string>();
  const out: ReferenceImage[] = [];
  for (const item of pool) {
    if (seen.has(item.imageUrl) || seen.has(item.documentId)) continue;
    seen.add(item.imageUrl);
    seen.add(item.documentId);
    out.push({
      documentId: item.documentId,
      title: item.title,
      collection: item.collection,
      imageUrl: item.imageUrl,
      mimeType: item.mimeType,
      fileName: item.fileName,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Email / Meta: share absolute photo links when native image send is unavailable. */
export function formatReferencePhotoLinksReply(
  photos: ReferenceImage[],
  askingMore = false,
): string {
  const header = askingMore
    ? "Sir, here are more reference photos:"
    : "Sir, here are some reference photos:";
  const lines = photos.map((p, i) => `${i + 1}. ${p.title}: ${p.imageUrl}`);
  return `${header}\n${lines.join("\n")}`;
}
