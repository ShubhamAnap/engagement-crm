import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";
import { automations } from "@/data/mock";
import { ArrowDown } from "lucide-react";
const flow = ["New Lead", "AI Qualification", "CRM Record", "Notify Sales", "Email Quotation", "48h Reminder", "Follow-up Call"];

export const Route = createFileRoute("/automation")({
  head: () => ({
    meta: [
      { title: "Automation — EnerTech Engage" },
      { name: "description", content: "Visual workflows that qualify leads, sync the CRM and chase follow-ups automatically." },
      { property: "og:title", content: "Automation — EnerTech Engage" },
      { property: "og:description", content: "Visual workflows that qualify leads, sync the CRM and chase follow-ups automatically." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Automation" description="Visual workflows that qualify leads, sync the CRM and chase follow-ups automatically." actions={<Button size="sm">New workflow</Button>} />
      <div className="space-y-4 p-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Panel title="Workflows" bodyClassName="p-0">
            <Toolbar placeholder="Search workflows…" />
            <ul className="divide-y divide-border">
              {automations.map((a) => (
                <li key={a.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-secondary/40">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{a.name}</p><p className="num truncate text-xs text-muted-foreground">{a.runs.toLocaleString()} runs · {a.success}% success · updated {a.updated}</p></div>
                  <Pill tone={a.status === "Live" ? "success" : "neutral"} dot>{a.status}</Pill>
                </li>
              ))}
            </ul>
            <TablePagination total={5} shown={5} />
          </Panel>
          <Panel title="New Lead Qualification" description="Visual builder preview">
            <div className="space-y-1.5">
              {flow.map((step, i) => (
                <div key={step}>
                  <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-sm font-medium">{step}</div>
                  {i < flow.length - 1 && <div className="flex justify-center py-0.5"><ArrowDown className="size-4 text-muted-foreground" /></div>}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
