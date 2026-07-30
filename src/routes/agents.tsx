import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";
import { aiAgents } from "@/data/mock";
import { Bot } from "lucide-react";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "AI Agents — EnerTech Engage" },
      { name: "description", content: "Purpose-built agents for sales, support, technical, warranty and follow-up workflows." },
      { property: "og:title", content: "AI Agents — EnerTech Engage" },
      { property: "og:description", content: "Purpose-built agents for sales, support, technical, warranty and follow-up workflows." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="AI Agents" description="Purpose-built agents for sales, support, technical, warranty and follow-up workflows." actions={<Button size="sm">New agent</Button>} />
      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {aiAgents.map((a) => (
            <Panel key={a.name} bodyClassName="p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary"><Bot className="size-4.5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{a.name}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{a.desc}</p>
                </div>
                <Pill tone={a.status === "Active" ? "success" : a.status === "Paused" ? "neutral" : "warning"} dot>{a.status}</Pill>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                {[["Health", a.health + "%"], ["Requests today", a.requests.toLocaleString()], ["Avg. latency", a.latency + " ms"], ["Memory", a.memory ? "Enabled" : "Disabled"], ["Model", a.model], ["Cost today", a.cost]].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-border bg-secondary/40 p-2">
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</dt>
                    <dd className="num mt-0.5 truncate text-sm font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" className="flex-1">Configure</Button><Button size="sm" variant="outline" className="flex-1">Logs</Button></div>
            </Panel>
          ))}
        </div>
      </div>
    </>
  );
}
