import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";
import { channelsConfig } from "@/data/mock";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/channels")({
  head: () => ({
    meta: [
      { title: "Channels — EnerTech Engage" },
      { name: "description", content: "Connection manager and health monitoring for every customer touchpoint." },
      { property: "og:title", content: "Channels — EnerTech Engage" },
      { property: "og:description", content: "Connection manager and health monitoring for every customer touchpoint." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Channels" description="Connection manager and health monitoring for every customer touchpoint." actions={<Button size="sm">Connect channel</Button>} />
      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {channelsConfig.map((c) => (
            <Panel key={c.name} bodyClassName="p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary"><ChannelIcon channel={c.key} className="text-muted-foreground" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{c.name}</p><p className="truncate text-xs text-muted-foreground">{c.detail}</p></div>
                <Switch defaultChecked={c.status === "Connected"} aria-label={"Enable " + c.name} />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <Pill tone={c.status === "Connected" ? "success" : c.status === "Degraded" ? "warning" : "danger"} dot>{c.status}</Pill>
                <span className="num text-xs text-muted-foreground">{c.volume}</span>
              </div>
              <div className="mt-3"><p className="mb-1 text-[11px] uppercase text-muted-foreground">Connection health</p><ScoreBar score={c.health} /></div>
            </Panel>
          ))}
        </div>
      </div>
    </>
  );
}
