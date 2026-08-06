import { cn } from "@/lib/utils";

export type ChatProductCard = {
  id: string;
  name: string;
  imageUrl?: string | null;
};

/** E-commerce style horizontal product cards for website chat. */
export function ChatProductCarousel(props: {
  products: ChatProductCard[];
  brand?: string;
  disabled?: boolean;
  onNeedThis: (productId: string) => void;
  className?: string;
}) {
  const brand = props.brand || "#0B2388";
  if (!props.products.length) return null;

  return (
    <div
      className={cn(
        "-mx-1 flex gap-2.5 overflow-x-auto overscroll-x-contain px-1 pb-1 pt-0.5 [scrollbar-width:thin] snap-x snap-mandatory",
        props.className,
      )}
      style={{ WebkitOverflowScrolling: "touch" }}
      onWheel={(e) => {
        // Prefer horizontal browse inside the strip
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.currentTarget.scrollWidth > e.currentTarget.clientWidth) {
          e.currentTarget.scrollLeft += e.deltaY;
        }
      }}
    >
      {props.products.map((p) => (
        <div
          key={p.id}
          className="w-[72%] max-w-[240px] shrink-0 snap-center overflow-hidden rounded-xl border bg-white shadow-sm"
          style={{ borderColor: `${brand}22` }}
        >
          <div className="flex h-36 items-center justify-center bg-[#EEF1F8]">
            {p.imageUrl ? (
              <img
                src={p.imageUrl}
                alt={p.name}
                className="max-h-36 w-full object-contain"
                loading="lazy"
              />
            ) : (
              <span className="px-3 text-center text-[11px] opacity-60" style={{ color: brand }}>
                No photo
              </span>
            )}
          </div>
          <div className="space-y-2 p-2.5">
            <p className="line-clamp-2 min-h-[2.5rem] text-xs font-semibold leading-snug" style={{ color: brand }}>
              {p.name}
            </p>
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => props.onNeedThis(p.id)}
              className="w-full rounded-lg py-2 text-xs font-semibold text-white transition-opacity hover:opacity-95 disabled:opacity-50"
              style={{ backgroundColor: brand }}
            >
              I need this
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function extractProductCarousel(
  meta: Record<string, unknown> | null | undefined,
): ChatProductCard[] {
  if (!meta?.product_carousel) return [];
  const raw = meta.products;
  if (!Array.isArray(raw)) return [];
  const out: ChatProductCard[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name : "";
    if (!id || !name) continue;
    out.push({
      id,
      name,
      imageUrl: typeof row.imageUrl === "string" ? row.imageUrl : null,
    });
  }
  return out;
}
