import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";
import { knowledgeCollections } from "@/data/mock";

export const Route = createFileRoute("/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge Base — EnerTech Engage" },
      { name: "description", content: "Collections, chunks, embeddings and versions powering every grounded AI answer." },
      { property: "og:title", content: "Knowledge Base — EnerTech Engage" },
      { property: "og:description", content: "Collections, chunks, embeddings and versions powering every grounded AI answer." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Knowledge Base" description="Collections, chunks, embeddings and versions powering every grounded AI answer." actions={<Button size="sm">Upload PDF</Button>} />
      <div className="space-y-4 p-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel title="Collections" bodyClassName="p-0">
            <Toolbar placeholder="Search documents and chunks…" />
            <ul className="divide-y divide-border">
              {knowledgeCollections.map((c) => (
                <li key={c.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-secondary/40">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="num truncate text-xs text-muted-foreground">{c.docs} documents · {c.chunks.toLocaleString()} chunks · updated {c.updated}</p>
                  </div>
                  <Pill tone={c.status === "Indexed" ? "success" : c.status === "Embedding" ? "info" : "warning"} dot>{c.status}</Pill>
                </li>
              ))}
            </ul>
            <TablePagination total={8} shown={8} />
          </Panel>
          <div className="space-y-4">
            <Panel title="Website Sync"><p className="text-sm text-muted-foreground">enertechups.com · 214 pages crawled · last sync 3h ago</p><Button size="sm" variant="outline" className="mt-3 w-full">Re-crawl now</Button></Panel>
            <Panel title="Chunk Viewer"><p className="rounded-lg bg-secondary p-3 text-xs leading-relaxed">“EN-3000X supports up to 16 × 12V batteries in a 96V string. At 60% load runtime is 42–48 minutes with 42Ah cells…”</p><p className="mt-2 text-[11px] text-muted-foreground">chunk 1042/4820 · 318 tokens · embedded</p></Panel>
            <Panel title="Version History" bodyClassName="p-0">
              <ul className="divide-y divide-border text-sm">
                {[["v4.2", "2h ago", "Ananya R."], ["v4.1", "6d ago", "Vikram S."], ["v4.0", "22d ago", "System"]].map(([v, t, w]) => (
                  <li key={v} className="flex items-center justify-between px-4 py-2.5"><span className="num">{v}</span><span className="text-xs text-muted-foreground">{w} · {t}</span></li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
