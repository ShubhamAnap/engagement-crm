import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, Download, FileText, Layers, LayoutGrid, List, Pencil, Plus, RefreshCw, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { EmptyState, PageHeader, Panel, Pill, TablePagination, Toolbar } from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { DbCategoryCatalogue, DbProduct, StockStatus } from "@/lib/db-types";
import { normalizeCategoryKey } from "@/lib/product-card";
import {
  createProduct,
  deleteProduct,
  downloadProductsCsv,
  listCategoryCatalogues,
  listProducts,
  productCatalogueHref,
  productImageHref,
  removeCategoryCataloguePdf,
  removeProductCataloguePdf,
  removeProductImage,
  toCategoryCatalogueLookup,
  updateProduct,
  uploadCategoryCataloguePdf,
  uploadProductCataloguePdf,
  uploadProductImage,
} from "@/lib/products-api";
import {
  downloadProductsImportTemplate,
  importProductsFromCsv,
  MAX_PRODUCT_IMPORT_ROWS,
} from "@/lib/products-import";
import { ensureKnowledgeStorage } from "@/server/knowledge";
import { getWordpressSetup, syncWordpressCatalog } from "@/server/wordpress-catalog";

const stockOptions: StockStatus[] = ["In Stock", "Low Stock", "Made to Order", "Out of Stock"];

type ProductSourceFilter = "all" | "wordpress" | "manual";
type ProductStockFilter = "all" | StockStatus;
type ProductSort =
  | "name-asc"
  | "name-desc"
  | "sku-asc"
  | "category-asc"
  | "price-asc"
  | "price-desc"
  | "newest"
  | "oldest";

const sortOptions: { value: ProductSort; label: string }[] = [
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "sku-asc", label: "SKU A–Z" },
  { value: "category-asc", label: "Category" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
];

function isWordpressProduct(product: DbProduct): boolean {
  return (product.specs as { source?: string } | null)?.source === "wordpress";
}

function productCategoryLabel(product: DbProduct): string {
  const label = product.category?.trim();
  return label ? label : "Uncategorized";
}

type ProductFormState = {
  sku: string;
  name: string;
  category: string;
  description: string;
  stockStatus: StockStatus;
  quantity: string;
  priceLabel: string;
  mrpLabel: string;
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
  mrpLabel: "",
  batterySpec: "",
  runtimeSpec: "",
};

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Product Catalog" },
      { name: "description", content: "UPS systems, batteries and accessories with specs, stock, images and catalogue PDFs." },
      { property: "og:title", content: "Product Catalog" },
      { property: "og:description", content: "UPS systems, batteries and accessories with specs, stock, images and catalogue PDFs." },
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
    mrpLabel: product.mrp_label || "",
    batterySpec: product.battery_spec || "",
    runtimeSpec: product.runtime_spec || "",
  };
}

function Page() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id;
  const catalogInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const categoryFileRef = useRef<HTMLInputElement>(null);
  const pendingCategoryLabelRef = useRef<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState<ProductStockFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<ProductSourceFilter>("all");
  const [sortKey, setSortKey] = useState<ProductSort>("name-asc");
  const [catalogView, setCatalogView] = useState<"grid" | "table">(() => {
    try {
      return localStorage.getItem("enertech-products-view") === "table" ? "table" : "grid";
    } catch {
      return "grid";
    }
  });
  const pageSize = 24;
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<DbProduct | null>(null);
  const [productToDelete, setProductToDelete] = useState<DbProduct | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importCsvText, setImportCsvText] = useState<string | null>(null);
  const [form, setForm] = useState<ProductFormState>(defaultForm);
  const [pendingCatalogPdf, setPendingCatalogPdf] = useState<File | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);

  const productsQuery = useQuery({
    queryKey: ["products", orgId],
    enabled: Boolean(orgId),
    queryFn: () => listProducts(orgId!),
  });

  const categoryQuery = useQuery({
    queryKey: ["category-catalogues", orgId],
    enabled: Boolean(orgId),
    queryFn: () => listCategoryCatalogues(orgId!),
  });

  const catLookup = useMemo(
    () => toCategoryCatalogueLookup(categoryQuery.data ?? []),
    [categoryQuery.data],
  );

  const categoryRows = useMemo(() => {
    const byKey = new Map<
      string,
      { key: string; label: string; count: number; catalogue: DbCategoryCatalogue | null }
    >();
    for (const product of productsQuery.data ?? []) {
      const label = String(product.category || "").trim().replace(/\s+/g, " ");
      const key = normalizeCategoryKey(label);
      if (!key) continue;
      const existing = byKey.get(key);
      if (existing) existing.count += 1;
      else {
        byKey.set(key, {
          key,
          label,
          count: 1,
          catalogue: (categoryQuery.data ?? []).find((row) => row.category_key === key) ?? null,
        });
      }
    }
    for (const row of categoryQuery.data ?? []) {
      const existing = byKey.get(row.category_key);
      if (existing) existing.catalogue = row;
      else {
        byKey.set(row.category_key, {
          key: row.category_key,
          label: row.category_label,
          count: 0,
          catalogue: row,
        });
      }
    }
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [productsQuery.data, categoryQuery.data]);

  const wpSetupQuery = useQuery({
    queryKey: ["wordpress-setup"],
    queryFn: () => getWordpressSetup(),
  });

  const syncWpMutation = useMutation({
    mutationFn: () => syncWordpressCatalog(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["products", orgId] });
      await queryClient.invalidateQueries({ queryKey: ["wordpress-setup"] });
      toast.success(
        `WordPress sync: ${result.created} new · ${result.updated} updated · ${result.fetched} pulled`,
      );
      if (result.deactivated) {
        toast.message(`${result.deactivated} unpublished Woo products marked inactive`);
      }
      if (result.errors.length) {
        toast.message("Some products failed", { description: result.errors[0] });
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "WordPress sync failed"),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Your profile is still loading");
      if (!form.sku.trim()) throw new Error("SKU is required");
      if (!form.name.trim()) throw new Error("Product name is required");
      const quantity = Number(form.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Quantity must be 0 or more");
      const payload = {
        orgId,
        sku: form.sku,
        name: form.name,
        category: form.category,
        description: form.description,
        stockStatus: form.stockStatus,
        quantity,
        priceLabel: form.priceLabel,
        mrpLabel: form.mrpLabel,
        batterySpec: form.batterySpec,
        runtimeSpec: form.runtimeSpec,
      };
      const saved = editingProduct ? await updateProduct(editingProduct.id, payload) : await createProduct(payload);

      let result = saved;
      if (pendingImage) {
        await ensureKnowledgeStorage();
        result = await uploadProductImage({
          orgId,
          productId: saved.id,
          file: pendingImage,
        });
      }
      if (pendingCatalogPdf) {
        await ensureKnowledgeStorage();
        result = await uploadProductCataloguePdf({
          orgId,
          productId: saved.id,
          file: pendingCatalogPdf,
        });
      }
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products", orgId] });
      toast.success(editingProduct ? "Product updated" : "Product created");
      setDialogOpen(false);
      setEditingProduct(null);
      setForm(defaultForm);
      setPendingCatalogPdf(null);
      setPendingImage(null);
      if (catalogInputRef.current) catalogInputRef.current.value = "";
      if (imageInputRef.current) imageInputRef.current.value = "";
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not save product");
    },
  });

  const importMutation = useMutation({
    mutationFn: async (csvText: string) => {
      if (!orgId) throw new Error("Your profile is still loading");
      return importProductsFromCsv({ orgId, csvText });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["products", orgId] });
      setImportOpen(false);
      setImportFileName(null);
      setImportCsvText(null);
      if (importInputRef.current) importInputRef.current.value = "";
      const parts = [
        `${result.imported} imported`,
        result.skippedDuplicate ? `${result.skippedDuplicate} skipped (duplicate SKU)` : null,
        result.skippedInvalid ? `${result.skippedInvalid} skipped (invalid)` : null,
      ].filter(Boolean);
      toast.success(parts.join(" · "));
      if (result.errors.length > 0) {
        toast.message(
          `Notes: ${result.errors.slice(0, 3).join("; ")}${result.errors.length > 3 ? "…" : ""}`,
        );
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Import failed"),
  });

  const onImportFile = (file: File | null) => {
    if (!file) {
      setImportFileName(null);
      setImportCsvText(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      toast.error("Please choose a .csv file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImportFileName(file.name);
      setImportCsvText(typeof reader.result === "string" ? reader.result : null);
    };
    reader.onerror = () => toast.error("Could not read CSV file");
    reader.readAsText(file);
  };

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

  const imageMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!orgId || !editingProduct) throw new Error("Open a product to upload its image");
      await ensureKnowledgeStorage();
      return uploadProductImage({ orgId, productId: editingProduct.id, file });
    },
    onSuccess: async (updated) => {
      setEditingProduct(updated);
      setPendingImage(null);
      if (imageInputRef.current) imageInputRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["products", orgId] });
      toast.success("Product image uploaded");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Image upload failed"),
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

  const uploadCategoryMutation = useMutation({
    mutationFn: async ({ label, file }: { label: string; file: File }) => {
      if (!orgId) throw new Error("Your profile is still loading");
      await ensureKnowledgeStorage();
      return uploadCategoryCataloguePdf({ orgId, categoryLabel: label, file });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["category-catalogues", orgId] });
      toast.success("Category catalogue uploaded — SKUs in this category inherit it");
      pendingCategoryLabelRef.current = null;
      if (categoryFileRef.current) categoryFileRef.current.value = "";
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Category catalogue upload failed"),
  });

  const removeCategoryMutation = useMutation({
    mutationFn: async (row: DbCategoryCatalogue) => {
      if (!orgId) throw new Error("No product selected");
      return removeCategoryCataloguePdf({
        orgId,
        categoryKey: row.category_key,
        storagePath: row.catalog_pdf_path,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["category-catalogues", orgId] });
      toast.success("Category catalogue removed");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not remove category catalogue"),
  });

  const removeImageMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !editingProduct) throw new Error("No product selected");
      return removeProductImage({
        orgId,
        productId: editingProduct.id,
        storagePath: editingProduct.image_path,
      });
    },
    onSuccess: async (updated) => {
      setEditingProduct(updated);
      await queryClient.invalidateQueries({ queryKey: ["products", orgId] });
      toast.success("Product image removed");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not remove image"),
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

  const categoryOptions = useMemo(() => {
    const labels = new Set<string>();
    for (const product of productsQuery.data ?? []) {
      labels.add(productCategoryLabel(product));
    }
    return [...labels].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [productsQuery.data]);

  const filterCount =
    (categoryFilter !== "all" ? 1 : 0) + (stockFilter !== "all" ? 1 : 0) + (sourceFilter !== "all" ? 1 : 0);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = (productsQuery.data ?? []).filter((product) => {
      if (categoryFilter !== "all" && productCategoryLabel(product) !== categoryFilter) return false;
      if (stockFilter !== "all" && product.stock_status !== stockFilter) return false;
      if (sourceFilter === "wordpress" && !isWordpressProduct(product)) return false;
      if (sourceFilter === "manual" && isWordpressProduct(product)) return false;
      if (!q) return true;
      return [product.sku, product.name, product.category, product.battery_spec, product.runtime_spec, product.price_label, product.mrp_label]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });

    const sorted = [...items];
    sorted.sort((a, b) => {
      if (sortKey === "name-asc" || sortKey === "name-desc") {
        const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        return sortKey === "name-desc" ? -cmp : cmp;
      }
      if (sortKey === "sku-asc") {
        return a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: "base" });
      }
      if (sortKey === "category-asc") {
        return productCategoryLabel(a).localeCompare(productCategoryLabel(b), undefined, { sensitivity: "base" });
      }
      if (sortKey === "price-asc" || sortKey === "price-desc") {
        const av = a.price_paise ?? Number.POSITIVE_INFINITY;
        const bv = b.price_paise ?? Number.POSITIVE_INFINITY;
        return sortKey === "price-desc" ? bv - av : av - bv;
      }
      const at = new Date(a.created_at).getTime();
      const bt = new Date(b.created_at).getTime();
      return sortKey === "oldest" ? at - bt : bt - at;
    });
    return sorted;
  }, [productsQuery.data, search, categoryFilter, stockFilter, sourceFilter, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pagedProducts = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredProducts.slice(start, start + pageSize);
  }, [filteredProducts, safePage]);

  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, stockFilter, sourceFilter, sortKey]);

  const openCreate = () => {
    setEditingProduct(null);
    setForm(defaultForm);
    setPendingCatalogPdf(null);
    setPendingImage(null);
    if (catalogInputRef.current) catalogInputRef.current.value = "";
    if (imageInputRef.current) imageInputRef.current.value = "";
    setDialogOpen(true);
  };

  const openEdit = (product: DbProduct) => {
    setEditingProduct(product);
    setForm(formFromProduct(product));
    setPendingCatalogPdf(null);
    setPendingImage(null);
    if (catalogInputRef.current) catalogInputRef.current.value = "";
    if (imageInputRef.current) imageInputRef.current.value = "";
    setDialogOpen(true);
  };

  const hasOwnCatalog = Boolean(editingProduct?.catalog_pdf_url || editingProduct?.catalog_pdf_path);
  const currentCatalogUrl = editingProduct ? productCatalogueHref(editingProduct, catLookup) : null;
  const currentImageUrl = editingProduct ? productImageHref(editingProduct) : null;

  return (
    <>
      <PageHeader
        title="Product Catalog"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!wpSetupQuery.data?.configured || syncWpMutation.isPending}
              onClick={() => syncWpMutation.mutate()}
            >
              <RefreshCw className={`size-4 ${syncWpMutation.isPending ? "animate-spin" : ""}`} />
              {syncWpMutation.isPending ? "Syncing…" : "Sync from WordPress"}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCategoryDialogOpen(true)}>
              <Layers className="size-4" /> Category catalogues
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> Bulk import
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" /> Add product
            </Button>
          </div>
        }
      />
      <div className="space-y-4 p-6">
        {wpSetupQuery.data?.lastSyncAt || wpSetupQuery.data?.channelReady ? (
          <p className="text-xs text-muted-foreground">
            WordPress source: {wpSetupQuery.data.siteUrl || "enertechups.com"}
            {wpSetupQuery.data.lastSyncAt
              ? ` · last sync ${new Date(wpSetupQuery.data.lastSyncAt).toLocaleString()}`
              : " · not synced yet"}
            {wpSetupQuery.data.lastSyncResult ? ` · ${wpSetupQuery.data.lastSyncResult}` : ""}
            {" · "}
            <Link to="/channels" className="text-primary underline">
              Channels
            </Link>
          </p>
        ) : null}
        <Panel bodyClassName="p-0">
          <Toolbar
            placeholder="Search SKU, name or category…"
            value={search}
            onChange={setSearch}
            filter={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn("h-9 gap-1.5", filterCount > 0 && "border-primary text-primary")}
                    type="button"
                  >
                    <SlidersHorizontal className="size-4" /> Filter
                    {filterCount > 0 ? (
                      <span className="num rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold">
                        {filterCount}
                      </span>
                    ) : null}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
                  <DropdownMenuLabel>Category</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={categoryFilter} onValueChange={setCategoryFilter}>
                    <DropdownMenuRadioItem value="all">All categories</DropdownMenuRadioItem>
                    {categoryOptions.map((label) => (
                      <DropdownMenuRadioItem key={label} value={label}>
                        {label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Stock</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={stockFilter}
                    onValueChange={(v) => setStockFilter(v as ProductStockFilter)}
                  >
                    <DropdownMenuRadioItem value="all">All stock</DropdownMenuRadioItem>
                    {stockOptions.map((status) => (
                      <DropdownMenuRadioItem key={status} value={status}>
                        {status}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Source</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={sourceFilter}
                    onValueChange={(v) => setSourceFilter(v as ProductSourceFilter)}
                  >
                    <DropdownMenuRadioItem value="all">All sources</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="wordpress">WordPress</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="manual">Manual</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  {filterCount > 0 ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => {
                          setCategoryFilter("all");
                          setStockFilter("all");
                          setSourceFilter("all");
                        }}
                      >
                        Clear filters
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            }
            sort={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-1.5" type="button">
                    <ArrowUpDown className="size-4" /> Sort
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={sortKey} onValueChange={(v) => setSortKey(v as ProductSort)}>
                    {sortOptions.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            }
            right={
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-md border border-border p-0.5">
                  <Button
                    size="sm"
                    variant={catalogView === "grid" ? "secondary" : "ghost"}
                    className="h-8 gap-1.5 px-2"
                    type="button"
                    onClick={() => {
                      setCatalogView("grid");
                      try {
                        localStorage.setItem("enertech-products-view", "grid");
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    <LayoutGrid className="size-3.5" /> Cards
                  </Button>
                  <Button
                    size="sm"
                    variant={catalogView === "table" ? "secondary" : "ghost"}
                    className="h-8 gap-1.5 px-2"
                    type="button"
                    onClick={() => {
                      setCatalogView("table");
                      try {
                        localStorage.setItem("enertech-products-view", "table");
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    <List className="size-3.5" /> Table
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (filteredProducts.length === 0) {
                      toast.message("Nothing to export");
                      return;
                    }
                    downloadProductsCsv(filteredProducts, undefined, catLookup);
                    toast.success(`Exported ${filteredProducts.length} products`);
                  }}
                >
                  Export CSV
                </Button>
              </div>
            }
          />

          {productsQuery.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading products…</div>
          ) : filteredProducts.length === 0 ? (
            <div className="p-4"><EmptyState title={search || filterCount > 0 ? "No matching products" : "No products yet"} description={search || filterCount > 0 ? "Try a different search or clear filters." : "Add your first product to build the catalog."} /></div>
          ) : (
            <>
              {catalogView === "grid" ? (
                <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {pagedProducts.map((product) => {
                    const catalogUrl = productCatalogueHref(product, catLookup);
                    const imageUrl = productImageHref(product);
                    const wp = isWordpressProduct(product);
                    return (
                      <article
                        key={product.id}
                        className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
                      >
                        <div className="relative aspect-[4/3] bg-muted">
                          {imageUrl ? (
                            <img src={imageUrl} alt="" className="size-full object-contain p-2" />
                          ) : (
                            <div className="grid size-full place-items-center text-xs text-muted-foreground">
                              No photo
                            </div>
                          )}
                          {wp ? (
                            <span className="absolute top-2 left-2">
                              <Pill tone="info">WP</Pill>
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-1 flex-col gap-2 p-3">
                          <div>
                            <p className="line-clamp-2 text-sm font-semibold leading-snug">{product.name}</p>
                            <p className="num mt-0.5 text-[11px] text-muted-foreground">{product.sku}</p>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {productCategoryLabel(product)}
                          </p>
                          <div className="mt-auto flex items-baseline gap-2">
                            <span className="num text-sm font-semibold">{product.price_label || "—"}</span>
                            {product.mrp_label && product.mrp_label !== product.price_label ? (
                              <span className="num text-xs text-muted-foreground line-through">
                                {product.mrp_label}
                              </span>
                            ) : null}
                          </div>
                          <Pill tone={stockTone(product.stock_status)}>{product.stock_status}</Pill>
                          <div className="flex flex-wrap gap-2 pt-1">
                            {catalogUrl ? (
                              <Button size="sm" variant="outline" className="gap-1.5" asChild>
                                <a href={catalogUrl} target="_blank" rel="noreferrer">
                                  <FileText className="size-3.5" /> PDF
                                </a>
                              </Button>
                            ) : null}
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
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {["SKU", "Product", "Category", "Batteries", "Runtime", "Stock", "Price", "MRP", "Image", "Catalogue", "Actions"].map((h) => (
                        <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pagedProducts.map((product) => {
                      const catalogUrl = productCatalogueHref(product, catLookup);
                      const imageUrl = productImageHref(product);
                      const ownPdf = Boolean(product.catalog_pdf_url || product.catalog_pdf_path);
                      return (
                        <tr key={product.id} className="hover:bg-secondary/40">
                          <td className="num px-4 py-3 whitespace-nowrap">{product.sku}</td>
                          <td className="px-4 py-3 font-medium whitespace-nowrap">
                            <span>{product.name}</span>
                            {(product.specs as { source?: string } | null)?.source === "wordpress" ? (
                              <Pill className="ml-2" tone="info">
                                WP
                              </Pill>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{product.category || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{product.battery_spec || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{product.runtime_spec || "—"}</td>
                          <td className="px-4 py-3"><Pill tone={stockTone(product.stock_status)}>{product.stock_status}</Pill></td>
                          <td className="num px-4 py-3 whitespace-nowrap">{product.price_label || "—"}</td>
                          <td className="num px-4 py-3 text-muted-foreground whitespace-nowrap">{product.mrp_label || "—"}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt=""
                                className="size-10 rounded-md border border-border object-cover"
                              />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {catalogUrl ? (
                              <div className="flex items-center gap-1.5">
                                <Button size="sm" variant="outline" className="gap-1.5" asChild>
                                  <a href={catalogUrl} target="_blank" rel="noreferrer">
                                    <FileText className="size-3.5" /> PDF
                                  </a>
                                </Button>
                                {!ownPdf ? (
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                    category
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
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
              )}
              <TablePagination
                total={filteredProducts.length}
                shown={pagedProducts.length}
                page={safePage}
                pageSize={pageSize}
                onPageChange={setPage}
              />
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
            setPendingImage(null);
            if (catalogInputRef.current) catalogInputRef.current.value = "";
            if (imageInputRef.current) imageInputRef.current.value = "";
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Edit product" : "Add product"}</DialogTitle>
            <DialogDescription>
              {editingProduct
                ? "Update details, WhatsApp card image, and catalogue PDF."
                : "Create a product. You can attach an image and catalogue PDF now or after saving. Category catalogues are shared unless this SKU has its own PDF."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="product-sku">SKU</Label><Input id="product-sku" value={form.sku} onChange={(e) => setForm((s) => ({ ...s, sku: e.target.value }))} placeholder="EN-3000X" /></div>
            <div className="space-y-2"><Label htmlFor="product-name">Product name</Label><Input id="product-name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="EnerTech Online UPS" /></div>
            <div className="space-y-2"><Label htmlFor="product-category">Category</Label><Input id="product-category" value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))} placeholder="UPS / Battery / Service" /></div>
            <div className="space-y-2"><Label>Stock status</Label><Select value={form.stockStatus} onValueChange={(value: StockStatus) => setForm((s) => ({ ...s, stockStatus: value }))}><SelectTrigger><SelectValue placeholder="Select stock status" /></SelectTrigger><SelectContent>{stockOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="product-quantity">Quantity</Label><Input id="product-quantity" type="number" min="0" value={form.quantity} onChange={(e) => setForm((s) => ({ ...s, quantity: e.target.value }))} /></div>
            <div className="space-y-2"><Label htmlFor="product-price">Price</Label><Input id="product-price" value={form.priceLabel} onChange={(e) => setForm((s) => ({ ...s, priceLabel: e.target.value }))} placeholder="₹45,900" /></div>
            <div className="space-y-2"><Label htmlFor="product-mrp">MRP</Label><Input id="product-mrp" value={form.mrpLabel} onChange={(e) => setForm((s) => ({ ...s, mrpLabel: e.target.value }))} placeholder="₹52,900" /></div>
            <div className="space-y-2"><Label htmlFor="product-battery">Battery spec</Label><Input id="product-battery" value={form.batterySpec} onChange={(e) => setForm((s) => ({ ...s, batterySpec: e.target.value }))} placeholder="8 x 42Ah" /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="product-runtime">Runtime spec</Label><Input id="product-runtime" value={form.runtimeSpec} onChange={(e) => setForm((s) => ({ ...s, runtimeSpec: e.target.value }))} placeholder="42–48 minutes at 60% load" /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="product-description">Description</Label><Textarea id="product-description" value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} placeholder="Product overview, positioning, or technical summary" /></div>

            <div className="space-y-2 sm:col-span-2 rounded-lg border border-border bg-secondary/20 p-3">
              <Label htmlFor="product-image">WhatsApp card image</Label>
              <p className="text-xs text-muted-foreground">
                Public HTTPS image (PNG/JPEG/WebP, max 5 MB). Inbox → Recommend sends this with name, price, and features.
              </p>
              {currentImageUrl ? (
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <img
                    src={currentImageUrl}
                    alt=""
                    className="size-16 rounded-md border border-border object-cover"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={removeImageMutation.isPending}
                    onClick={() => removeImageMutation.mutate()}
                  >
                    Remove image
                  </Button>
                </div>
              ) : null}
              <Input
                id="product-image"
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                className="mt-2"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setPendingImage(file);
                  if (file && editingProduct) {
                    imageMutation.mutate(file);
                  }
                }}
              />
              {pendingImage && !editingProduct ? (
                <p className="text-xs text-muted-foreground">Will upload on create: {pendingImage.name}</p>
              ) : null}
              {imageMutation.isPending ? (
                <p className="text-xs text-muted-foreground">Uploading image…</p>
              ) : null}
            </div>

            <div className="space-y-2 sm:col-span-2 rounded-lg border border-border bg-secondary/20 p-3">
              <Label htmlFor="product-catalog">Catalogue PDF</Label>
              <p className="text-xs text-muted-foreground">
                Optional override for this SKU. Otherwise WhatsApp uses the category catalogue.
                Short link: <code className="rounded bg-secondary px-1">/c/YOUR-SKU</code>.
              </p>
              {currentCatalogUrl ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" className="gap-1.5" asChild>
                    <a href={currentCatalogUrl} target="_blank" rel="noreferrer">
                      <FileText className="size-3.5" /> View current PDF
                    </a>
                  </Button>
                  {hasOwnCatalog ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={removeCatalogMutation.isPending}
                      onClick={() => removeCatalogMutation.mutate()}
                    >
                      Remove PDF
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Inherited from category</span>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground pt-1">
                  No PDF yet. Upload one here, or set it once under Category catalogues.
                </p>
              )}
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
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || catalogMutation.isPending || imageMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : editingProduct ? "Update product" : "Create product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={categoryDialogOpen}
        onOpenChange={(open) => {
          setCategoryDialogOpen(open);
          if (!open) {
            pendingCategoryLabelRef.current = null;
            if (categoryFileRef.current) categoryFileRef.current.value = "";
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Category catalogues</DialogTitle>
            <DialogDescription>
              Upload one PDF per category. Every SKU in that category inherits it unless the product has
              its own file. Woo sync does not overwrite these.
            </DialogDescription>
          </DialogHeader>
          <input
            ref={categoryFileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              const label = pendingCategoryLabelRef.current;
              e.target.value = "";
              if (!file || !label) return;
              uploadCategoryMutation.mutate({ label, file });
            }}
          />
          {categoryQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading categories…</p>
          ) : categoryRows.length === 0 ? (
            <EmptyState
              title="No categories yet"
              description="Add or sync products with a category, then upload one PDF here."
            />
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {categoryRows.map((row) => {
                const pdfUrl = row.catalogue?.catalog_pdf_url || null;
                return (
                  <div key={row.key} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.count} {row.count === 1 ? "product" : "products"}
                        {pdfUrl ? " · catalogue set" : " · no PDF"}
                      </p>
                    </div>
                    {pdfUrl ? (
                      <Button size="sm" variant="outline" className="gap-1.5" asChild>
                        <a href={pdfUrl} target="_blank" rel="noreferrer">
                          <FileText className="size-3.5" /> PDF
                        </a>
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={uploadCategoryMutation.isPending}
                      onClick={() => {
                        pendingCategoryLabelRef.current = row.label;
                        categoryFileRef.current?.click();
                      }}
                    >
                      {pdfUrl ? "Replace" : "Upload"}
                    </Button>
                    {row.catalogue ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        disabled={removeCategoryMutation.isPending}
                        onClick={() => removeCategoryMutation.mutate(row.catalogue!)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) {
            setImportFileName(null);
            setImportCsvText(null);
            if (importInputRef.current) importInputRef.current.value = "";
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk import products</DialogTitle>
            <DialogDescription>
              Download the CSV template, fill product details (max {MAX_PRODUCT_IMPORT_ROWS} rows), then
              upload. Images and catalogue PDFs are not in the CSV — add those later per product. Existing
              SKUs are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Button
              type="button"
              variant="outline"
              className="w-full gap-1.5"
              onClick={() => downloadProductsImportTemplate()}
            >
              <Download className="size-4" />
              Download CSV template
            </Button>
            <div className="space-y-2">
              <Label htmlFor="products-csv">Upload CSV</Label>
              <input
                ref={importInputRef}
                id="products-csv"
                type="file"
                accept=".csv,text/csv"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
                onChange={(e) => onImportFile(e.target.files?.[0] ?? null)}
              />
              {importFileName ? (
                <p className="text-xs text-muted-foreground">Selected: {importFileName}</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!importCsvText || importMutation.isPending}
              onClick={() => {
                if (!importCsvText) return;
                importMutation.mutate(importCsvText);
              }}
            >
              {importMutation.isPending ? "Importing…" : "Import"}
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
