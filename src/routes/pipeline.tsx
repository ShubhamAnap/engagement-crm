import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";
import { leads, pipelineStages } from "@/data/mock";

export const Route = createFileRoute("/pipeline")({
  head: () => ({
    meta: [
      { title: "Sales Pipeline — EnerTech Engage" },
      { name: "description", content: "Drag deals across stages from first touch to closed won." },
      { property: "og:title", content: "Sales Pipeline — EnerTech Engage" },
      { property: "og:description", content: "Drag deals across stages from first touch to closed won." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Sales Pipeline" description="Drag deals across stages from first touch to closed won." actions={<Button size="sm">New deal</Button>} />
      <div className="space-y-4 p-6">
        <div className="grid gap-3 overflow-x-auto lg:grid-cols-6">
          {pipelineStages.map((s) => (
            <div key={s.key} className="min-w-[220px] rounded-xl border border-border bg-secondary/30 p-2.5">
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</p>
                <span className="num text-xs text-muted-foreground">{s.ids.length}</span>
              </div>
              <div className="space-y-2">
                {s.ids.map((id) => {
                  const l = leads.find((x) => x.id === id)!;
                  return (
                    <div key={id} draggable className="cursor-grab rounded-lg border border-border bg-card p-3 active:cursor-grabbing">
                      <p className="truncate text-sm font-medium">{l.company}</p>
                      <p className="truncate text-xs text-muted-foreground">{l.name} · {l.product}</p>
                      <div className="mt-2 flex items-center justify-between"><span className="num text-sm font-semibold">{l.value}</span><ScoreBar score={l.score} /></div>
                    </div>
                  );
                })}
                {s.ids.length === 0 && <p className="px-1 py-6 text-center text-xs text-muted-foreground">Drop deals here</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
