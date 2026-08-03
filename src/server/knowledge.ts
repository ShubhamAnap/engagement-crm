import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { chunkText, embedQuery, embedTexts, estimateTokens } from "@/server/embeddings";
import { shortKnowledgeDocumentUrl, shortProductCatalogueUrl } from "@/lib/short-links";
import { shortenStorageUrl } from "@/server/shorten-urls";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
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

function assertSupportedFile(fileName: string, mimeType?: string | null) {
  const lower = fileName.toLowerCase();
  const mime = (mimeType || "").toLowerCase();
  if (lower.endsWith(".doc") || lower.endsWith(".docx") || mime.includes("msword") || mime.includes("wordprocessingml")) {
    throw new Error("Word .doc/.docx is not supported yet. Please upload PDF, TXT, Markdown, or images.");
  }
  const ok =
    isImageFile(fileName, mimeType) ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".csv") ||
    mime.includes("pdf") ||
    mime.includes("text");
  if (!ok) {
    throw new Error("Unsupported file type. Use PDF, TXT, Markdown, or images (PNG/JPG/WEBP/GIF).");
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
      `EnerTech knowledge image: ${title}.`,
      `Collection: ${collection}.`,
      `File name: ${fileName}.`,
      "This is a product/site photo available for customer viewing or download.",
      `If the visitor asks about ${collection}, photos, images, gallery, installation pictures, or site photos, share this image link.`,
    ].join(" ");
  }
  if (mime.includes("pdf") || lower.endsWith(".pdf")) {
    return [
      `EnerTech knowledge PDF: ${title}.`,
      `Collection: ${collection}.`,
      `File name: ${fileName}.`,
      "This document is available for customer download.",
      "If the visitor asks for a catalogue, datasheet, brochure, or PDF, share the download link for this file.",
    ].join(" ");
  }
  return buffer.toString("utf8");
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
  documentId: string;
  collectionId: string;
  fileName: string;
  title: string;
  mimeType: string | null;
  buffer: Buffer;
  storagePath: string;
}) {
  const { supabase, documentId, collectionId, fileName, title, mimeType, buffer, storagePath } = options;
  const sourceUrl = publicFileUrl(storagePath);

  const { data: collection } = await supabase
    .from("knowledge_collections")
    .select("name")
    .eq("id", collectionId)
    .maybeSingle();
  const collectionName = (collection?.name as string | undefined) || "Knowledge Base";

  await supabase
    .from("knowledge_documents")
    .update({
      storage_path: storagePath,
      source_url: sourceUrl,
      status: "processing",
      mime_type: mimeType,
      metadata: { fileName, kind: isImageFile(fileName, mimeType) ? "image" : "document" },
    })
    .eq("id", documentId);

  const text = extractTextFromBuffer(buffer, mimeType, fileName, { title, collectionName });
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error("No extractable text found in file");
  }

  let embeddings: number[][];
  try {
    embeddings = await embedTexts(chunks);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Embedding failed";
    throw new Error(`${message}. Confirm OPENAI_API_KEY is set on the server.`);
  }

  const rows = chunks.map((content, index) => ({
    org_id: ORG_ID,
    document_id: documentId,
    collection_id: collectionId,
    chunk_index: index,
    content,
    token_estimate: estimateTokens(content),
    embedding: toVectorLiteral(embeddings[index] ?? []),
    metadata: { fileName, title, collectionName, kind: isImageFile(fileName, mimeType) ? "image" : "document" },
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
    .update({ status: "ready", chunk_count: rows.length })
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
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("knowledge_collections")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const listKnowledgeDocuments = createServerFn({ method: "POST" })
  .validator(z.object({ collectionId: z.string().uuid().optional() }))
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    let q = supabase
      .from("knowledge_documents")
      .select("*, collection:knowledge_collections(id, name)")
      .eq("org_id", ORG_ID)
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
  .validator(z.object({ name: z.string().min(1).max(120), description: z.string().max(500).optional() }))
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const { data: created, error } = await supabase
      .from("knowledge_collections")
      .insert({
        org_id: ORG_ID,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        status: "Indexed",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return created;
  });

async function prepareUploadRecord(data: {
  collectionId: string;
  title: string;
  fileName: string;
  mimeType?: string;
}) {
  assertSupportedFile(data.fileName, data.mimeType);
  await ensureKnowledgeBucket();

  const supabase = createServiceSupabase();
  const { data: collection, error: collectionError } = await supabase
    .from("knowledge_collections")
    .select("id")
    .eq("id", data.collectionId)
    .eq("org_id", ORG_ID)
    .maybeSingle();
  if (collectionError) throw new Error(collectionError.message);
  if (!collection) throw new Error("Collection not found");

  const { data: doc, error: docError } = await supabase
    .from("knowledge_documents")
    .insert({
      org_id: ORG_ID,
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
  const storagePath = `${ORG_ID}/${data.collectionId}/${doc.id}/${safeName}`;
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
    .eq("org_id", ORG_ID)
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
    await supabase
      .from("knowledge_documents")
      .update({ status: "failed", metadata: { fileName, error: message } })
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

  const { data: doc, error } = await supabase
    .from("knowledge_documents")
    .select("id, storage_path, metadata")
    .eq("id", options.documentId)
    .eq("org_id", ORG_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc?.storage_path) throw new Error("Prepared document missing storage_path");

  const fileName =
    String((doc.metadata as { fileName?: string } | null)?.fileName || "document") || "document";

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(doc.storage_path as string, buffer, {
    contentType: options.mimeType || "application/octet-stream",
    upsert: true,
  });
  if (uploadError) {
    await supabase
      .from("knowledge_documents")
      .update({ status: "failed", metadata: { fileName, error: uploadError.message } })
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
    const supabase = createServiceSupabase();
    const { data: doc, error } = await supabase
      .from("knowledge_documents")
      .select("*")
      .eq("id", data.documentId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) throw new Error("Document not found");

    if (doc.storage_path) {
      await supabase.storage.from(BUCKET).remove([doc.storage_path as string]);
    }
    const { error: delError } = await supabase.from("knowledge_documents").delete().eq("id", data.documentId);
    if (delError) throw new Error(delError.message);

    await refreshCollectionCounts(supabase, doc.collection_id as string);
    return { ok: true };
  });

export type RetrievedChunk = {
  content: string;
  similarity: number;
  document_title: string;
  source_url: string | null;
  storage_path: string | null;
  download_url: string | null;
};

export async function retrieveKnowledgeContext(query: string, limit = 6): Promise<RetrievedChunk[]> {
  const supabase = createServiceSupabase();
  try {
    const embedding = await embedQuery(query);
    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: toVectorLiteral(embedding),
      match_org_id: ORG_ID,
      match_count: limit,
      match_threshold: 0.55,
    });
    if (error) throw new Error(error.message);
    const mapped: RetrievedChunk[] = [];
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const longUrl = row.storage_path
        ? publicFileUrl(String(row.storage_path))
        : (row.source_url as string) || null;
      const docId = row.document_id ? String(row.document_id) : "";
      const shortFromDoc = docId ? shortKnowledgeDocumentUrl(docId) : null;
      mapped.push({
        content: String(row.content ?? ""),
        similarity: Number(row.similarity ?? 0),
        document_title: String(row.document_title ?? "Document"),
        source_url: (row.source_url as string) || null,
        storage_path: (row.storage_path as string) || null,
        download_url: shortFromDoc || (longUrl ? await shortenStorageUrl(longUrl) : null),
      });
    }
    return mapped;
  } catch (err) {
    console.error("Knowledge retrieval failed", err);
    return [];
  }
}

export async function findCatalogueDownloads(query: string): Promise<Array<{ title: string; url: string }>> {
  const q = query.toLowerCase();
  const wantsPdf = /pdf|catalogue|catalog|datasheet|brochure|download|spec sheet|manual/.test(q);
  const wantsImage = /image|photo|picture|pic|gallery|installation|site photo|jpg|png/.test(q);
  if (!wantsPdf && !wantsImage) return [];

  const supabase = createServiceSupabase();
  const links: Array<{ title: string; url: string }> = [];

  const { data: docs } = await supabase
    .from("knowledge_documents")
    .select("id, title, source_url, storage_path, mime_type, metadata, collection:knowledge_collections(name)")
    .eq("org_id", ORG_ID)
    .eq("status", "ready")
    .order("updated_at", { ascending: false })
    .limit(40);

  for (const doc of docs ?? []) {
    const mime = (doc.mime_type as string | null) || "";
    const fileName = String((doc.metadata as { fileName?: string } | null)?.fileName || "");
    const collectionRel = doc.collection as { name?: string } | { name?: string }[] | null;
    const collectionName = String(
      Array.isArray(collectionRel) ? collectionRel[0]?.name || "" : collectionRel?.name || "",
    );
    const isImage = isImageFile(fileName, mime) || mime.startsWith("image/");
    const isPdf =
      mime.includes("pdf") ||
      fileName.toLowerCase().endsWith(".pdf") ||
      /catalog|datasheet|brochure|manual/i.test(doc.title as string);

    const include =
      (wantsImage && isImage) ||
      (wantsPdf && isPdf);
    if (!include) continue;

    const hay = `${doc.title} ${fileName} ${collectionName}`.toLowerCase();
    const queryTokens = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const matchesTopic =
      queryTokens.some((w) => hay.includes(w)) ||
      /photo|image|picture|gallery|pdf|catalogue|catalog|datasheet|brochure|manual|download/.test(q);
    if (!matchesTopic) continue;

    const longUrl = doc.storage_path
      ? publicFileUrl(doc.storage_path as string)
      : (doc.source_url as string | null);
    if (longUrl) {
      const url = doc.id
        ? shortKnowledgeDocumentUrl(String(doc.id))
        : await shortenStorageUrl(longUrl);
      const label = collectionName ? `${doc.title as string} (${collectionName})` : (doc.title as string);
      links.push({ title: label, url });
    }
  }

  if (wantsPdf) {
    const { data: products } = await supabase
      .from("products")
      .select("id, name, sku, catalog_pdf_url, catalog_pdf_path")
      .eq("org_id", ORG_ID)
      .eq("is_active", true)
      .limit(50);

    for (const product of products ?? []) {
      const hasCatalog = Boolean(
        (product.catalog_pdf_url as string | null) || (product.catalog_pdf_path as string | null),
      );
      if (!hasCatalog) continue;
      const hay = `${product.name} ${product.sku}`.toLowerCase();
      if (
        q.includes("catalog") ||
        q.includes("catalogue") ||
        q.includes("pdf") ||
        hay.split(/\s+/).some((w) => w.length > 2 && q.includes(w))
      ) {
        const sku = String(product.sku || "").trim();
        const long =
          (product.catalog_pdf_url as string | null) ||
          (product.catalog_pdf_path ? publicFileUrl(product.catalog_pdf_path as string) : null);
        const url = (sku ? shortProductCatalogueUrl(sku) : null) || (long ? await shortenStorageUrl(long) : null);
        if (url) {
          links.push({ title: `${product.name} catalogue`, url });
        }
      }
    }
  }

  const seen = new Set<string>();
  return links
    .filter((l) => {
      if (seen.has(l.url)) return false;
      seen.add(l.url);
      return true;
    })
    .slice(0, 8);
}
