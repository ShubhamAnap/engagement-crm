import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";
import { leads } from "@/data/mock";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/leads")({
  head: () => ({
    meta: [
      { title: "Lead Management — EnerTech Engage" },
      { name: "description", content: "AI-scored leads with source, ownership, product interest and follow-up scheduling." },
      { property: "og:title", content: "Lead Management — EnerTech Engage" },
      { property: "og:description", content: "AI-scored leads with source, ownership, product interest and follow-up scheduling." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Lead Management" description="AI-scored leads with source, ownership, product interest and follow-up scheduling." actions={<Button size="sm">New lead</Button>} />
      <div className="space-y-4 p-6">
        <Panel bodyClassName="p-0">
          <Toolbar placeholder="Search leads by name, company or product…" right={<Button size="sm" variant="outline">Bulk assign</Button>} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5"><Checkbox aria-label="Select all" /></th>
                  {["Score", "Status", "Priority", "Source", "Name", "Company", "Phone", "Interested", "Owner", "Last activity", "Next follow-up"].map((h) => <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((l) => (
                  <tr key={l.id} className="hover:bg-secondary/40">
                    <td className="px-4 py-3"><Checkbox aria-label={"Select " + l.name} /></td>
                    <td className="px-4 py-3"><ScoreBar score={l.score} /></td>
                    <td className="px-4 py-3"><Pill tone={l.status === "Won" ? "success" : l.status === "Lost" ? "danger" : l.status === "Qualified" ? "primary" : "neutral"}>{l.status}</Pill></td>
                    <td className="px-4 py-3"><Pill tone={l.priority === "High" ? "warning" : "neutral"}>{l.priority}</Pill></td>
                    <td className="px-4 py-3"><ChannelIcon channel={l.source} className="text-muted-foreground" /></td>
                    <td className="px-4 py-3 font-medium whitespace-nowrap">{l.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{l.company}</td>
                    <td className="num px-4 py-3 text-muted-foreground whitespace-nowrap">{l.phone}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{l.product}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{l.owner}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{l.lastActivity}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{l.nextFollowUp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination total={218} shown={leads.length} />
        </Panel>
      </div>
    </>
  );
}
