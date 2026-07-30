import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";
import { products } from "@/data/mock";

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

function Page() {
  return (
    <>
      <PageHeader title="Product Catalog" description="UPS systems, batteries and accessories with specifications, stock and AI recommendation weights." actions={<Button size="sm">Add product</Button>} />
      <div className="space-y-4 p-6">
        <Panel bodyClassName="p-0">
          <Toolbar placeholder="Search SKU, name or category…" right={<Button size="sm" variant="outline">Bulk actions</Button>} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>{["SKU", "Product", "Category", "Batteries", "Runtime", "Stock", "Price", "AI weight"].map((h) => <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((p) => (
                  <tr key={p.sku} className="hover:bg-secondary/40">
                    <td className="num px-4 py-3 whitespace-nowrap">{p.sku}</td>
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{p.category}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{p.batteries}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{p.runtime}</td>
                    <td className="px-4 py-3"><Pill tone={p.stock === "In Stock" ? "success" : p.stock === "Low Stock" ? "warning" : "neutral"}>{p.stock}</Pill></td>
                    <td className="num px-4 py-3 whitespace-nowrap">{p.price}</td>
                    <td className="px-4 py-3"><ScoreBar score={Math.round(p.weight * 100)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination total={128} shown={products.length} />
        </Panel>
      </div>
    </>
  );
}
