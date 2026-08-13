import { useEffect, useMemo, useState } from "react";
import { ImageIcon, Loader2, Package, Search } from "lucide-react";
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
import { Pill } from "@/components/shared/ui-kit";
import type { DbProduct } from "@/lib/db-types";
import { formatPrice, formatProductRecommendationCaption, productImageHref } from "@/lib/products-api";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: DbProduct[];
  loading?: boolean;
  contactName?: string | null;
  contactPhone?: string | null;
  sending?: boolean;
  onSend: (product: DbProduct) => Promise<void> | void;
  onManageProducts?: () => void;
};

export function RecommendProductDialog({
  open,
  onOpenChange,
  products,
  loading,
  contactName,
  contactPhone,
  sending,
  onSend,
  onManageProducts,
}: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DbProduct | null>(null);

  const active = useMemo(
    () => products.filter((p) => p.is_active !== false),
    [products],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return active;
    return active.filter((p) =>
      [p.name, p.sku, p.category, p.price_label, p.mrp_label, p.description]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [active, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected(null);
    }
  }, [open]);

  const imageUrl = selected ? productImageHref(selected) : null;
  const captionPreview = selected ? formatProductRecommendationCaption(selected) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Package className="size-4" />
            Recommend product
          </DialogTitle>
          <DialogDescription>
            Send a product card on WhatsApp
            {contactName || contactPhone
              ? ` to ${[contactName, contactPhone ? `+${contactPhone}` : null].filter(Boolean).join(" · ")}`
              : ""}
            . Photo + caption when an image is set; otherwise caption as text.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-5 py-4">
          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search name, SKU, category…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading products…
            </div>
          ) : filtered.length === 0 ? (
            <div className="space-y-3 py-8 text-center text-sm text-muted-foreground">
              <p>{query ? "No matching products." : "No active products yet."}</p>
              {onManageProducts ? (
                <Button size="sm" variant="outline" onClick={onManageProducts}>
                  Open Products
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {filtered.map((p) => {
                const img = productImageHref(p);
                const isSel = selected?.id === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        isSel
                          ? "border-primary bg-primary/5"
                          : "border-transparent hover:border-border hover:bg-secondary/50",
                      )}
                      onClick={() => setSelected(p)}
                    >
                      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-secondary/40">
                        {img ? (
                          <img src={img} alt="" className="size-full object-cover" />
                        ) : (
                          <ImageIcon className="size-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[p.sku, p.category, formatPrice(p)].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                      {!img ? <Pill tone="neutral">Text only</Pill> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selected ? (
            <div className="shrink-0 space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                WhatsApp preview {imageUrl ? "(image + caption)" : "(text message)"}
              </div>
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={selected.name}
                  className="max-h-28 rounded-md border border-border object-contain"
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  No product image — add one under Products → Edit for a photo card.
                </p>
              )}
              <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground">
                {captionPreview}
              </pre>
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-5 py-3 sm:justify-between">
          <div>
            {onManageProducts ? (
              <Button type="button" variant="ghost" size="sm" onClick={onManageProducts}>
                Manage products
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!selected || sending}
              onClick={() => {
                if (selected) void onSend(selected);
              }}
            >
              {sending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Sending…
                </>
              ) : (
                "Send recommendation"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
