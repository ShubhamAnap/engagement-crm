import { useMemo, useRef, useState, type DragEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, ImageIcon, Plus, Trash2, Upload } from "lucide-react";
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
  listKnowledgeCollections,
  listKnowledgeDocuments,
  prepareKnowledgeUpload,
  uploadPreparedKnowledgeDocument,
} from "@/server/knowledge";
import { getBrowserSupabase } from "@/lib/supabase";

export const Route = createFileRoute("/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge Base — EnerTech Engage" },
      {
        name: "description",
        content: "Organize collections (e.g. Cold Storage, Petrol Pump) with PDFs, text, and images for EnerBot.",
      },
      { property: "og:title", content: "Knowledge Base — EnerTech Engage" },
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
  metadata?: { fileName?: string; kind?: string } | null;
};

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
  const [docTitle, setDocTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [search, setSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);

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
    return all.filter((d) => String(d.title || "").toLowerCase().includes(q));
  }, [documentsQuery.data, search]);

  const imageDocs = useMemo(() => documents.filter(isImageDoc), [documents]);
  const fileDocs = useMemo(() => documents.filter((d) => !isImageDoc(d)), [documents]);

  const createMutation = useMutation({
    mutationFn: async () =>
      createKnowledgeCollection({
        data: { name: collectionName, description: collectionDescription || undefined },
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["knowledge-collections"] });
      setSelectedCollectionId(created.id as string);
      setCreateOpen(false);
      setCollectionName("");
      setCollectionDescription("");
      toast.success("Collection created");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not create collection"),
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

  const activeCollection = collections.find((c: { id: string }) => c.id === activeCollectionId) ?? null;

  return (
    <>
      <PageHeader
        title="Knowledge Base"
        description="Create collections (Cold Storage, Petrol Pump, …) and add PDFs, text, or images. EnerBot retrieves them in chat."
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
                }) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedCollectionId(c.id)}
                      className={`w-full px-4 py-3 text-left hover:bg-secondary/40 ${activeCollectionId === c.id ? "bg-secondary/70" : ""}`}
                    >
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
                      </p>
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
                  <div className="flex flex-wrap gap-2">
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
                <div className="p-4">
                  <EmptyState
                    title="No images or docs yet"
                    description={`Choose files from your computer to add them under ${activeCollection?.name || "this collection"}.`}
                    icon={ImageIcon}
                    action={
                      <Button className="gap-1.5" disabled={uploadMutation.isPending} onClick={startLocalImagePick}>
                        <Upload className="size-3.5" />
                        Choose images from computer
                      </Button>
                    }
                  />
                </div>
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
                        {imageDocs.map((d) => (
                          <div key={d.id} className="overflow-hidden rounded-lg border border-border bg-card">
                            <a href={d.download_url || "#"} target="_blank" rel="noreferrer" className="block aspect-square bg-muted">
                              {d.download_url ? (
                                <img src={d.download_url} alt={d.title} className="size-full object-cover" loading="lazy" />
                              ) : (
                                <div className="flex size-full items-center justify-center text-xs text-muted-foreground">No preview</div>
                              )}
                            </a>
                            <div className="flex items-start gap-1 p-2">
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
                          </div>
                        ))}
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
                <li>Create a collection per site or product line (e.g. <span className="font-medium text-foreground">Cold Storage</span>, <span className="font-medium text-foreground">Petrol Pump</span>).</li>
                <li>Upload many images and docs into that collection — they stay grouped together.</li>
                <li>Files are stored in Supabase Storage; text stubs are embedded for EnerBot search.</li>
                <li>If a visitor asks for Cold Storage photos or a Petrol Pump catalogue, EnerBot can share the matching links.</li>
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
              Example: Cold Storage, Petrol Pump, Hospital UPS — then upload images and docs under it.
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
              PDF, TXT, Markdown, or images (PNG/JPG/WEBP/GIF). Select multiple images at once. Max ~12 MB each.
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
                accept=".pdf,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.gif,application/pdf,text/plain,text/markdown,image/*"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              {files.length > 0 ? (
                <p className="text-xs text-muted-foreground">{files.length} file{files.length === 1 ? "" : "s"} selected</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button disabled={files.length === 0 || uploadMutation.isPending} onClick={() => uploadMutation.mutate()}>
              {uploadMutation.isPending ? "Uploading…" : "Upload & index"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
