import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, Panel, Pill, ScoreBar, TablePagination, Toolbar } from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import type { DbProduct, StockStatus } from "@/lib/db-types";
import {
  createProduct,
  deleteProduct,
  listProducts,
  productCatalogueHref,
  removeProductCataloguePdf,
  updateProduct,
  uploadProductCataloguePdf,
} from "@/lib/products-api";
import { ensureKnowledgeStorage } from "@/server/knowledge";

const stockOptions: StockStatus[] = ["In Stock", "Low Stock", "Made to Order", "Out of Stock"];

type ProductFormState = {
  sku: string;
  name: string;
  category: string;
  description: string;
  stockStatus: StockStatus;
  quantity: string;
  priceLabel: string;
  aiWeight: string;
  batterySpec: string;
  runtimeSpec: string;
};

const defaultForm: ProductFormState = {
  sku: "",
  name: "",
  category: "",
  description: "",
  stockStatus: "In Stock",
  quantity: "0",
  priceLabel: "",
  aiWeight: "0.50",
  batterySpec: "",
  runtimeSpec: "",
};

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Product Catalog — EnerTech Engage" },
      { name: "description", content: "UPS systems, batteries and accessories with specifications, stock and AI recommendation weights." },
      { property: "og:title", content: "Product Catalog — EnerTech Engage" },
      { property: "og:description", content: "UPS systems, batteries and accessories with specifications, stock and AI recommendation weights." },
    ],
  }),
  component: Page,
});

function stockTone(status: StockStatus): "success" | "warning" | "neutral" {
  if (status === "In Stock") return "success";
  if (status === "Low Stock") return "warning";
  return "neutral";
}

function formFromProduct(product: DbProduct): ProductFormState {
  return {
    sku: product.sku,
    name: product.name,
    category: product.category || "",
    description: product.description || "",
    stockStatus: product.stock_status,
    quantity: String(product.quantity),
    priceLabel: product.price_label || "",
    aiWeight: Number(product.ai_weight).toFixed(2),
    batterySpec: product.battery_spec || "",
    runtimeSpec: product.runtime_spec || "",
  };
}

function Page() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id;
  const catalogInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<DbProduct | null>(null);
  const [productToDelete, setProductToDelete] = useState<DbProduct | null>(null);
  const [form, setForm] = useState<ProductFormState>(defaultForm);
  const [pendingCatalogPdf, setPendingCatalogPdf] = useState<File | null>(null);

  const productsQuery = useQuery({
    queryKey: ["products", orgId],
    enabled: Boolean(orgId),
    queryFn: () => listProducts(orgId!),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Your profile is still loading");
      if (!form.sku.trim()) throw new Error("SKU is required");
      if (!form.name.trim()) throw new Error("Product name is required");
      const quantity = Number(form.quantity);
      const aiWeight = Number(form.aiWeight);
      if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Quantity must be 0 or more");
      if (!Number.isFinite(aiWeight) || aiWeight < 0 || aiWeight > 1) throw new Error("AI weight must be between 0 and 1");
      const payload = {
        orgId,
        sku: form.sku,
        name: form.name,
        category: form.category,
        description: form.description,
        stockStatus: form.stockStatus,
        quantity,
        priceLabel: form.priceLabel,
        aiWeight,
        batterySpec: form.batterySpec,
        runtimeSpec: form.runtimeSpec,
      };
      const saved = editingProduct ? await updateProduct(editingProduct.id, payload) : await createProduct(payload);

      if (pendingCatalogPdf) {
        await ensureKnowledgeStorage();
        return uploadProductCataloguePdf({
          orgId,
          productId: saved.id,
          file: pendingCatalogPdf,
        });
      }
      return saved;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products", orgId] });
      toast.success(editingProduct ? "Product updated" : "Product created");
      setDialogOpen(false);
      setEditingProduct(null);
      setForm(defaultForm);
      setPendingCatalogPdf(null);
      if (catalogInputRef.current) catalogInputRef.current.value = "";
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not save product");
    },
  });

  const catalogMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!orgId || !editingProduct) throw new Error("Open a product to upload its catalogue");
      await ensureKnowledgeStorage();
      return uploadProductCataloguePdf({ orgId, productId: editingProduct.id, file });
    },
    onSuccess: async (updated) => {
      setEditingProduct(updated);
      setPendingCatalogPdf(null);
      if (catalogInputRef.current) catalogInputRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["products", orgId] });
      toast.success("Catalogue PDF uploaded");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Catalogue upload failed"),
  });

  const removeCatalogMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !editingProduct) throw new Error("No product selected");
      return removeProductCataloguePdf({
        orgId,
        productId: editingProduct.id,
        storagePath: editingProduct.catalog_pdf_path,
      });
    },
    onSuccess: async (updated) => {
      setEditingProduct(updated);
      await queryClient.invalidateQueries({ queryKey: ["products", orgId] });
      toast.success("Catalogue PDF removed");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not remove catalogue"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (productId: string) => deleteProduct(productId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products", orgId] });
      toast.success("Product deleted");
      setProductToDelete(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not delete product");
    },
  });

  const filteredProducts = useMemo(() => {
    const items = productsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((product) =>
      [product.sku, product.name, product.category, product.battery_spec, product.runtime_spec, product.price_label]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [productsQuery.data, search]);

  const openCreate = () => {
    setEditingProduct(null);
    setForm(defaultForm);
    setPendingCatalogPdf(null);
    if (catalogInputRef.current) catalogInputRef.current.value = "";
    setDialogOpen(true);
  };

  const openEdit = (product: DbProduct) => {
    setEditingProduct(product);
    setForm(formFromProduct(product));
    setPendingCatalogPdf(null);
    if (catalogInputRef.current) catalogInputRef.current.value = "";
    setDialogOpen(true);
  };

  const currentCatalogUrl = editingProduct ? productCatalogueHref(editingProduct) : null;

  return (
    <>
      <PageHeader
        title="Product Catalog"
        description="UPS systems, batteries and accessories — attach a catalogue PDF per product for EnerBot downloads."
        actions={<Button size="sm" onClick={openCreate}><Plus className="size-4" /> Add product</Button>}
      />
      <div className="space-y-4 p-6">
        <Panel bodyClassName="p-0">
          <Toolbar placeholder="Search SKU, name or category…" value={search} onChange={setSearch} right={<Button size="sm" variant="outline" onClick={() => toast("Bulk actions come next")}>Bulk actions</Button>} />

          {productsQuery.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading products…</div>
          ) : filteredProducts.length === 0 ? (
            <div className="p-4"><EmptyState title={search ? "No matching products" : "No products yet"} description={search ? "Try a different search term." : "Add your first product to build the catalog."} /></div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {["SKU", "Product", "Category", "Batteries", "Runtime", "Stock", "Price", "Catalogue", "AI weight", "Actions"].map((h) => (
                        <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredProducts.map((product) => {
                      const catalogUrl = productCatalogueHref(product);
                      return (
                        <tr key={product.id} className="hover:bg-secondary/40">
                          <td className="num px-4 py-3 whitespace-nowrap">{product.sku}</td>
                          <td className="px-4 py-3 font-medium whitespace-nowrap">{product.name}</td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{product.category || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{product.battery_spec || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{product.runtime_spec || "—"}</td>
                          <td className="px-4 py-3"><Pill tone={stockTone(product.stock_status)}>{product.stock_status}</Pill></td>
                          <td className="num px-4 py-3 whitespace-nowrap">{product.price_label || "—"}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {catalogUrl ? (
                              <Button size="sm" variant="outline" className="gap-1.5" asChild>
                                <a href={catalogUrl} target="_blank" rel="noreferrer">
                                  <FileText className="size-3.5" /> PDF
                                </a>
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3"><ScoreBar score={Math.round(Number(product.ai_weight) * 100)} /></td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" onClick={() => openEdit(product)}>
                                <Pencil className="size-4" /> Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setProductToDelete(product)}
                              >
                                <Trash2 className="size-4" /> Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <TablePagination total={filteredProducts.length} shown={filteredProducts.length} />
            </>
          )}
        </Panel>
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingProduct(null);
            setForm(defaultForm);
            setPendingCatalogPdf(null);
            if (catalogInputRef.current) catalogInputRef.current.value = "";
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Edit product" : "Add product"}</DialogTitle>
            <DialogDescription>
              {editingProduct
                ? "Update product details and attach a catalogue PDF for EnerBot."
                : "Create a product. You can attach a catalogue PDF now or after saving."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="product-sku">SKU</Label><Input id="product-sku" value={form.sku} onChange={(e) => setForm((s) => ({ ...s, sku: e.target.value }))} placeholder="EN-3000X" /></div>
            <div className="space-y-2"><Label htmlFor="product-name">Product name</Label><Input id="product-name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="EnerTech Online UPS" /></div>
            <div className="space-y-2"><Label htmlFor="product-category">Category</Label><Input id="product-category" value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))} placeholder="UPS / Battery / Service" /></div>
            <div className="space-y-2"><Label>Stock status</Label><Select value={form.stockStatus} onValueChange={(value: StockStatus) => setForm((s) => ({ ...s, stockStatus: value }))}><SelectTrigger><SelectValue placeholder="Select stock status" /></SelectTrigger><SelectContent>{stockOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="product-quantity">Quantity</Label><Input id="product-quantity" type="number" min="0" value={form.quantity} onChange={(e) => setForm((s) => ({ ...s, quantity: e.target.value }))} /></div>
            <div className="space-y-2"><Label htmlFor="product-price">Price</Label><Input id="product-price" value={form.priceLabel} onChange={(e) => setForm((s) => ({ ...s, priceLabel: e.target.value }))} placeholder="₹52,900" /></div>
            <div className="space-y-2"><Label htmlFor="product-weight">AI weight</Label><Input id="product-weight" type="number" min="0" max="1" step="0.01" value={form.aiWeight} onChange={(e) => setForm((s) => ({ ...s, aiWeight: e.target.value }))} /></div>
            <div className="space-y-2"><Label htmlFor="product-battery">Battery spec</Label><Input id="product-battery" value={form.batterySpec} onChange={(e) => setForm((s) => ({ ...s, batterySpec: e.target.value }))} placeholder="8 x 42Ah" /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="product-runtime">Runtime spec</Label><Input id="product-runtime" value={form.runtimeSpec} onChange={(e) => setForm((s) => ({ ...s, runtimeSpec: e.target.value }))} placeholder="42–48 minutes at 60% load" /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="product-description">Description</Label><Textarea id="product-description" value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} placeholder="Product overview, positioning, or technical summary" /></div>

            <div className="space-y-2 sm:col-span-2 rounded-lg border border-border bg-secondary/20 p-3">
              <Label htmlFor="product-catalog">Catalogue PDF</Label>
              <p className="text-xs text-muted-foreground">
                Stored in Supabase Storage. EnerBot can share this link when customers ask for a catalogue.
              </p>
              {currentCatalogUrl ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" className="gap-1.5" asChild>
                    <a href={currentCatalogUrl} target="_blank" rel="noreferrer">
                      <FileText className="size-3.5" /> View current PDF
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={removeCatalogMutation.isPending}
                    onClick={() => removeCatalogMutation.mutate()}
                  >
                    Remove PDF
                  </Button>
                </div>
              ) : null}
              <Input
                id="product-catalog"
                ref={catalogInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="mt-2"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setPendingCatalogPdf(file);
                  if (file && editingProduct) {
                    catalogMutation.mutate(file);
                  }
                }}
              />
              {pendingCatalogPdf && !editingProduct ? (
                <p className="text-xs text-muted-foreground">Will upload on create: {pendingCatalogPdf.name}</p>
              ) : null}
              {catalogMutation.isPending ? (
                <p className="text-xs text-muted-foreground">Uploading catalogue…</p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saveMutation.isPending}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || catalogMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : editingProduct ? "Update product" : "Create product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(productToDelete)} onOpenChange={(open) => !open && setProductToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>{productToDelete ? `This will permanently delete ${productToDelete.name} (${productToDelete.sku}).` : "This action cannot be undone."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); if (productToDelete) deleteMutation.mutate(productToDelete.id); }}>{deleteMutation.isPending ? "Deleting…" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
