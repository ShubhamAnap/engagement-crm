import { useMemo, useRef, useState, type DragEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, ImageIcon, Plus, RefreshCw, Tag, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  ListSkeleton,
  PageHeader,
  Panel,
  Pill,
  Toolbar,
} from "@/components/shared/ui-kit";
import {
  createKnowledgeCollection,
  deleteKnowledgeDocument,
  ensureKnowledgeStorage,
  indexKnowledgeDocument,
  isPdfStubDocument,
  listKnowledgeCollections,
  listKnowledgeDocuments,
  normalizeKnowledgeTags,
  prepareKnowledgeUpload,
  reindexKnowledgeCollection,
  updateKnowledgeCollection,
  updateKnowledgeDocumentTags,
  uploadPreparedKnowledgeDocument,
} from "@/server/knowledge";
import { getBrowserSupabase } from "@/lib/supabase";

export const Route = createFileRoute("/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge Base" },
      {
        name: "description",
        content: "Organize collections with PDFs, text, and images for the AI assistant.",
      },
      { property: "og:title", content: "Knowledge Base" },
    ],
  }),
  component: Page,
});

type KnowledgeDoc = {
  id: string;
  title: string;
  status: string;
  chunk_count: number;
  mime_type?: string | null;
  download_url?: string | null;
  updated_at: string;
  metadata?: {
    fileName?: string;
    kind?: string;
    tags?: string[];
    pdf_text_extracted?: boolean;
    index_stub?: boolean;
  } | null;
};

type CollectionPurpose = "datasheets" | "site_photos" | "policies" | "faqs" | "other";

const PURPOSE_LABELS: Record<CollectionPurpose, string> = {
  datasheets: "Datasheets / catalogues",
  site_photos: "Site / reference photos",
  policies: "Policies",
  faqs: "FAQs",
  other: "Other",
};

const STATE_TAG_SUGGESTIONS = [
  "Maharashtra",
  "Gujarat",
  "Rajasthan",
  "Karnataka",
  "Tamil Nadu",
  "Kerala",
  "Telangana",
  "Andhra Pradesh",
  "Delhi",
  "Punjab",
  "Haryana",
  "Madhya Pradesh",
  "Uttar Pradesh",
  "West Bengal",
  "Goa",
];

function docTags(d: KnowledgeDoc): string[] {
  return normalizeKnowledgeTags(d.metadata?.tags);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64 || "");
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function isImageDoc(d: KnowledgeDoc): boolean {
  const mime = (d.mime_type || "").toLowerCase();
  const name = String(d.metadata?.fileName || d.title || "").toLowerCase();
  return (
    d.metadata?.kind === "image" ||
    mime.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|bmp)$/.test(name)
  );
}

async function uploadOneFile(options: {
  collectionId: string;
  title: string;
  file: File;
}) {
  const { collectionId, title, file } = options;
  const prepared = await prepareKnowledgeUpload({
    data: {
      collectionId,
      title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
      fileName: file.name,
      mimeType: file.type || undefined,
    },
  });

  const browser = getBrowserSupabase();
  const { error: storageError } = await browser.storage.from(prepared.bucket).upload(prepared.storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: true,
  });

  if (storageError) {
    if (file.size > 12 * 1024 * 1024) {
      throw new Error(
        `Storage upload failed: ${storageError.message}. File is too large for server fallback (max 12 MB).`,
      );
    }
    const base64 = await fileToBase64(file);
    return uploadPreparedKnowledgeDocument({
      data: {
        documentId: prepared.documentId,
        mimeType: file.type || undefined,
        base64,
      },
    });
  }

  return indexKnowledgeDocument({ data: { documentId: prepared.documentId } });
}

function Page() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const quickImageRef = useRef<HTMLInputElement>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [collectionDescription, setCollectionDescription] = useState("");
  const [collectionPurpose, setCollectionPurpose] = useState<CollectionPurpose | "">("site_photos");
  const [docTitle, setDocTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [search, setSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [tagsDoc, setTagsDoc] = useState<KnowledgeDoc | null>(null);
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const collectionsQuery = useQuery({
    queryKey: ["knowledge-collections"],
    queryFn: () => listKnowledgeCollections(),
  });

  const collections = collectionsQuery.data ?? [];
  const activeCollectionId = selectedCollectionId || (collections[0]?.id as string | undefined) || null;

  const documentsQuery = useQuery({
    queryKey: ["knowledge-documents", activeCollectionId],
    enabled: Boolean(activeCollectionId),
    queryFn: () => listKnowledgeDocuments({ data: { collectionId: activeCollectionId! } }),
  });

  const documents = useMemo(() => {
    const all = (documentsQuery.data ?? []) as KnowledgeDoc[];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((d) => {
      if (String(d.title || "").toLowerCase().includes(q)) return true;
      return docTags(d).some((t) => t.toLowerCase().includes(q));
    });
  }, [documentsQuery.data, search]);

  const imageDocs = useMemo(() => documents.filter(isImageDoc), [documents]);
  const fileDocs = useMemo(() => documents.filter((d) => !isImageDoc(d)), [documents]);

  const createMutation = useMutation({
    mutationFn: async () =>
      createKnowledgeCollection({
        data: {
          name: collectionName,
          description: collectionDescription || undefined,
          purpose: collectionPurpose || undefined,
        },
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["knowledge-collections"] });
      setSelectedCollectionId(created.id as string);
      setCreateOpen(false);
      setCollectionName("");
      setCollectionDescription("");
      setCollectionPurpose("site_photos");
      toast.success("Collection created");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not create collection"),
  });

  const reindexMutation = useMutation({
    mutationFn: async (documentId: string) => indexKnowledgeDocument({ data: { documentId } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["knowledge-documents"] }),
        queryClient.invalidateQueries({ queryKey: ["knowledge-collections"] }),
      ]);
      toast.success("Re-indexed");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Re-index failed"),
  });

  const reindexAllMutation = useMutation({
    mutationFn: async () => {
      if (!activeCollectionId) throw new Error("Select a collection first");
      return reindexKnowledgeCollection({ data: { collectionId: activeCollectionId } });
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["knowledge-documents"] }),
        queryClient.invalidateQueries({ queryKey: ["knowledge-collections"] }),
      ]);
      if (result.failed > 0) {
        toast.error(`Re-indexed ${result.ok}/${result.total}. ${result.errors[0] || "Some failed."}`);
      } else {
        toast.success(`Re-indexed ${result.ok} file${result.ok === 1 ? "" : "s"}`);
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Re-index failed"),
  });

  const purposeMutation = useMutation({
    mutationFn: async (purpose: CollectionPurpose) => {
      if (!activeCollectionId) throw new Error("Select a collection first");
      return updateKnowledgeCollection({ data: { collectionId: activeCollectionId, purpose } });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["knowledge-collections"] });
      toast.success("Purpose saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save purpose"),
  });

  const uploadMutation = useMutation({
    mutationFn: async (incoming?: File[]) => {
      const selected = incoming && incoming.length > 0 ? incoming : files;
      if (!activeCollectionId) throw new Error("Select a collection first");
      if (selected.length === 0) throw new Error("Choose at least one file");

      await ensureKnowledgeStorage();

      let ok = 0;
      for (const file of selected) {
        const title =
          selected.length === 1 && docTitle.trim()
            ? docTitle.trim()
            : file.name.replace(/\.[^.]+$/, "");
        await uploadOneFile({ collectionId: activeCollectionId, title, file });
        ok += 1;
      }
      return { count: ok };
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["knowledge-documents"] }),
        queryClient.invalidateQueries({ queryKey: ["knowledge-collections"] }),
      ]);
      setUploadOpen(false);
      setDocTitle("");
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      if (quickImageRef.current) quickImageRef.current.value = "";
      toast.success(result.count === 1 ? "Uploaded and indexed" : `${result.count} files uploaded and indexed`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Upload failed"),
  });

  function startLocalImagePick() {
    quickImageRef.current?.click();
  }

  function onQuickImagesChosen(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    uploadMutation.mutate(picked);
  }

  function onDropFiles(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const picked = Array.from(e.dataTransfer.files ?? []);
    if (picked.length === 0) return;
    uploadMutation.mutate(picked);
  }

  const deleteMutation = useMutation({
    mutationFn: async (documentId: string) => deleteKnowledgeDocument({ data: { documentId } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["knowledge-documents"] }),
        queryClient.invalidateQueries({ queryKey: ["knowledge-collections"] }),
      ]);
      toast.success("Deleted");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Delete failed"),
  });

  const tagsMutation = useMutation({
    mutationFn: async () => {
      if (!tagsDoc) throw new Error("No image selected");
      return updateKnowledgeDocumentTags({
        data: { documentId: tagsDoc.id, tags: tagDraft },
      });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["knowledge-documents"] });
      setTagsDoc(null);
      setTagDraft([]);
      setTagInput("");
      toast.success(
        result.tags.length
          ? `Tags saved (${result.tags.length})`
          : "Tags cleared",
      );
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save tags"),
  });

  function openTagsEditor(doc: KnowledgeDoc) {
    setTagsDoc(doc);
    setTagDraft(docTags(doc));
    setTagInput("");
  }

  function addTagFromInput() {
    const next = normalizeKnowledgeTags([...tagDraft, tagInput]);
    setTagDraft(next);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTagDraft((prev) => prev.filter((t) => t.toLowerCase() !== tag.toLowerCase()));
  }

  const activeCollection = collections.find((c: { id: string }) => c.id === activeCollectionId) ?? null;

  return (
    <>
      <PageHeader
        title="Knowledge Base"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" /> New collection
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!activeCollectionId}
              onClick={() => setUploadOpen(true)}
            >
              <FileUp className="size-3.5" /> Upload files
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Panel title="Collections" bodyClassName="p-0">
            {collectionsQuery.isLoading ? (
              <div className="p-3"><ListSkeleton rows={5} /></div>
            ) : collections.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No collections yet"
                  description='Create one like "Cold Storage" or "Petrol Pump", then upload images and docs under it.'
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {collections.map((c: {
                  id: string;
                  name: string;
                  doc_count: number;
                  chunk_count: number;
                  status: string;
                  purpose?: string | null;
                }) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedCollectionId(c.id)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/40 ${activeCollectionId === c.id ? "bg-secondary/70" : ""}`}
                    >
                      <span
                        className={`grid size-11 shrink-0 place-items-center rounded-lg ${
                          c.purpose === "site_photos"
                            ? "bg-warning/15 text-warning"
                            : c.purpose === "datasheets"
                              ? "bg-sky-500/15 text-sky-700 dark:text-sky-400"
                              : "bg-primary/10 text-primary"
                        }`}
                      >
                        <ImageIcon className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">{c.name}</p>
                          <Pill
                            tone={c.status === "Indexed" ? "success" : c.status === "Embedding" ? "info" : c.status === "Failed" ? "danger" : "warning"}
                            dot
                          >
                            {c.status}
                          </Pill>
                        </div>
                        <p className="num mt-1 text-xs text-muted-foreground">
                          {c.doc_count} items · {c.chunk_count} chunks
                          {c.purpose
                            ? ` · ${PURPOSE_LABELS[c.purpose as CollectionPurpose] || c.purpose}`
                            : ""}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel
              title={activeCollection ? activeCollection.name : "Collection contents"}
              description={
                activeCollection
                  ? `${imageDocs.length} images · ${fileDocs.length} docs · EnerBot can share these in chat`
                  : "Select or create a collection"
              }
              action={
                activeCollectionId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={String((activeCollection as { purpose?: string | null } | null)?.purpose || "other")}
                      onValueChange={(v) => purposeMutation.mutate(v as CollectionPurpose)}
                    >
                      <SelectTrigger className="h-8 w-[180px] text-xs">
                        <SelectValue placeholder="Purpose…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PURPOSE_LABELS) as CollectionPurpose[]).map((key) => (
                          <SelectItem key={key} value={key}>
                            {PURPOSE_LABELS[key]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={reindexAllMutation.isPending || fileDocs.length === 0}
                      onClick={() => {
                        if (confirm(`Re-index all ${fileDocs.length + imageDocs.length} files in this collection?`)) {
                          reindexAllMutation.mutate();
                        }
                      }}
                    >
                      <RefreshCw className={`size-3.5 ${reindexAllMutation.isPending ? "animate-spin" : ""}`} />
                      {reindexAllMutation.isPending ? "Re-indexing…" : "Re-index all"}
                    </Button>
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={uploadMutation.isPending}
                      onClick={startLocalImagePick}
                    >
                      <ImageIcon className="size-3.5" />
                      {uploadMutation.isPending ? "Uploading…" : "Add images"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={uploadMutation.isPending}
                      onClick={() => setUploadOpen(true)}
                    >
                      <FileUp className="size-3.5" /> Add PDF / files
                    </Button>
                  </div>
                ) : null
              }
              bodyClassName="p-0"
            >
              <input
                ref={quickImageRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                className="hidden"
                onChange={(e) => onQuickImagesChosen(e.target.files)}
              />

              {activeCollectionId ? (
                <div className="border-b border-border px-4 py-3">
                  <button
                    type="button"
                    disabled={uploadMutation.isPending}
                    onClick={startLocalImagePick}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                    }}
                    onDrop={onDropFiles}
                    className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${
                      dragOver
                        ? "border-primary bg-primary/5"
                        : "border-border bg-secondary/30 hover:border-primary/50 hover:bg-secondary/50"
                    }`}
                  >
                    <Upload className="size-6 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {uploadMutation.isPending
                          ? "Uploading from your computer…"
                          : `Upload images into ${activeCollection?.name || "this collection"}`}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Click to choose from your computer, or drag & drop PNG/JPG files here
                      </p>
                    </div>
                  </button>
                </div>
              ) : null}

              <Toolbar placeholder="Search in this collection…" value={search} onChange={setSearch} />
              {!activeCollectionId ? (
                <div className="p-4">
                  <EmptyState title="Select a collection" description="Pick a collection on the left or create one." />
                </div>
              ) : documentsQuery.isLoading ? (
                <div className="p-3"><ListSkeleton rows={5} /></div>
              ) : documents.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Drop images in the box above, or use Add PDF / files for documents.
                </p>
              ) : (
                <div className="space-y-4 p-4">
                  {imageDocs.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <ImageIcon className="size-4 text-muted-foreground" />
                          Images ({imageDocs.length})
                        </div>
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={startLocalImagePick}>
                          <Plus className="size-3.5" /> More images
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                        {imageDocs.map((d) => {
                          const tags = docTags(d);
                          return (
                          <div key={d.id} className="overflow-hidden rounded-lg border border-border bg-card">
                            <a href={d.download_url || "#"} target="_blank" rel="noreferrer" className="block aspect-square bg-muted">
                              {d.download_url ? (
                                <img src={d.download_url} alt={d.title} className="size-full object-cover" loading="lazy" />
                              ) : (
                                <div className="flex size-full items-center justify-center text-xs text-muted-foreground">No preview</div>
                              )}
                            </a>
                            <div className="space-y-1.5 p-2">
                              <div className="flex items-start gap-1">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-medium">{d.title}</p>
                                  <Pill
                                    tone={d.status === "ready" ? "success" : d.status === "failed" ? "danger" : "warning"}
                                    dot
                                  >
                                    {d.status}
                                  </Pill>
                                </div>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-7 shrink-0"
                                  aria-label="Edit tags"
                                  title="Tags (state / place)"
                                  onClick={() => openTagsEditor(d)}
                                >
                                  <Tag className="size-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-7 shrink-0 text-destructive"
                                  aria-label="Delete image"
                                  onClick={() => {
                                    if (confirm("Delete this image and its embeddings?")) {
                                      deleteMutation.mutate(d.id);
                                    }
                                  }}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                              {tags.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {tags.slice(0, 4).map((t) => (
                                    <span
                                      key={t}
                                      className="max-w-full truncate rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
                                      title={t}
                                    >
                                      {t}
                                    </span>
                                  ))}
                                  {tags.length > 4 ? (
                                    <span className="text-[10px] text-muted-foreground">+{tags.length - 4}</span>
                                  ) : null}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="text-left text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                                  onClick={() => openTagsEditor(d)}
                                >
                                  Add state / place tags
                                </button>
                              )}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {fileDocs.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Documents ({fileDocs.length})</p>
                      <ul className="divide-y divide-border rounded-lg border border-border">
                        {fileDocs.map((d) => (
                          <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{d.title}</p>
                              <p className="num truncate text-xs text-muted-foreground">
                                {d.chunk_count} chunks · {d.mime_type || "file"} · {new Date(d.updated_at).toLocaleString()}
                              </p>
                            </div>
                            {isPdfStubDocument(d) ? (
                              <Pill tone="warning" dot>
                                stub text
                              </Pill>
                            ) : null}
                            <Pill
                              tone={d.status === "ready" ? "success" : d.status === "processing" ? "info" : d.status === "failed" ? "danger" : "warning"}
                              dot
                            >
                              {d.status}
                            </Pill>
                            {d.download_url ? (
                              <Button size="sm" variant="outline" asChild>
                                <a href={d.download_url} target="_blank" rel="noreferrer">Open</a>
                              </Button>
                            ) : null}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8"
                              aria-label="Re-index document"
                              title="Re-index (extract PDF text + embeddings)"
                              disabled={reindexMutation.isPending}
                              onClick={() => reindexMutation.mutate(d.id)}
                            >
                              <RefreshCw className={`size-4 ${reindexMutation.isPending ? "animate-spin" : ""}`} />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 text-destructive"
                              aria-label="Delete document"
                              onClick={() => {
                                if (confirm("Delete this document and its embeddings?")) {
                                  deleteMutation.mutate(d.id);
                                }
                              }}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </Panel>

            <Panel title="How to use collections">
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  Set purpose to <span className="font-medium text-foreground">Datasheets / catalogues</span> for PDF
                  catalogues (EnerBot smart-match), or <span className="font-medium text-foreground">Site / reference photos</span> for
                  application galleries (Cold Storage, Petrol Pump, Hospital…).
                </li>
                <li>
                  Products module holds SKU photo + catalogue PDF for price packs; Knowledge Base Datasheets are for
                  shared brochure / datasheet asks.
                </li>
                <li>
                  After uploading PDFs, use <span className="font-medium text-foreground">Re-index</span> if you see a{" "}
                  <span className="font-medium text-foreground">stub text</span> badge — that means filename-only
                  embeddings (EnerBot cannot quote real specs until re-indexed).
                </li>
                <li>
                  Tag site photos with state / place (e.g. Maharashtra). Visitors who ask for references by place get
                  matching tagged photos.
                </li>
              </ul>
            </Panel>
          </div>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New collection</DialogTitle>
            <DialogDescription>
              Example: Cold Storage (site photos) or Datasheets (PDF catalogues) — then upload under it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="collection-name">Name</Label>
              <Input
                id="collection-name"
                value={collectionName}
                onChange={(e) => setCollectionName(e.target.value)}
                placeholder="Cold Storage"
              />
            </div>
            <div className="space-y-2">
              <Label>Purpose</Label>
              <Select
                value={collectionPurpose || "other"}
                onValueChange={(v) => setCollectionPurpose(v as CollectionPurpose)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PURPOSE_LABELS) as CollectionPurpose[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {PURPOSE_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="collection-desc">Description</Label>
              <Textarea
                id="collection-desc"
                value={collectionDescription}
                onChange={(e) => setCollectionDescription(e.target.value)}
                placeholder="Site photos and manuals for cold storage projects"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={!collectionName.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload to {activeCollection?.name || "collection"}</DialogTitle>
            <DialogDescription>
              PDF, DOCX, TXT, Markdown, or images (PNG/JPG/WEBP/GIF). Select multiple images at once. Max ~12 MB each.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="doc-title">Title (optional for multi-upload)</Label>
              <Input
                id="doc-title"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="Used only when uploading a single file"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-file">Files</Label>
              <Input
                id="doc-file"
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,image/*"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              {files.length > 0 ? (
                <p className="text-xs text-muted-foreground">{files.length} file{files.length === 1 ? "" : "s"} selected</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button disabled={files.length === 0 || uploadMutation.isPending} onClick={() => uploadMutation.mutate(undefined)}>
              {uploadMutation.isPending ? "Uploading…" : "Upload & index"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(tagsDoc)}
        onOpenChange={(open) => {
          if (!open) {
            setTagsDoc(null);
            setTagDraft([]);
            setTagInput("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Image tags</DialogTitle>
            <DialogDescription>
              Add state or place tags (e.g. Maharashtra). When customers ask for references by name,
              EnerBot prefers matching tagged photos from any collection.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="truncate text-sm font-medium text-foreground">{tagsDoc?.title}</p>
            <div className="flex flex-wrap gap-1.5">
              {tagDraft.length === 0 ? (
                <p className="text-xs text-muted-foreground">No tags yet</p>
              ) : (
                tagDraft.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground"
                  >
                    {t}
                    <button
                      type="button"
                      className="rounded-sm opacity-70 hover:opacity-100"
                      aria-label={`Remove ${t}`}
                      onClick={() => removeTag(t)}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Maharashtra, Pune, …"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTagFromInput();
                  }
                }}
              />
              <Button type="button" variant="secondary" onClick={addTagFromInput} disabled={!tagInput.trim()}>
                Add
              </Button>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Quick states</p>
              <div className="flex flex-wrap gap-1.5">
                {STATE_TAG_SUGGESTIONS.map((s) => {
                  const on = tagDraft.some((t) => t.toLowerCase() === s.toLowerCase());
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={on}
                      className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-secondary disabled:opacity-40"
                      onClick={() => setTagDraft((prev) => normalizeKnowledgeTags([...prev, s]))}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setTagsDoc(null);
                setTagDraft([]);
                setTagInput("");
              }}
            >
              Cancel
            </Button>
            <Button disabled={tagsMutation.isPending} onClick={() => tagsMutation.mutate()}>
              {tagsMutation.isPending ? "Saving…" : "Save tags"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
