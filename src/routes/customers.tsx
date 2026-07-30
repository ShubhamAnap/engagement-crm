import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";
import { leads } from "@/data/mock";

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customers — EnerTech Engage" },
      { name: "description", content: "Accounts, contacts, installed base and lifetime value across the EnerTech portfolio." },
      { property: "og:title", content: "Customers — EnerTech Engage" },
      { property: "og:description", content: "Accounts, contacts, installed base and lifetime value across the EnerTech portfolio." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Customers" description="Accounts, contacts, installed base and lifetime value across the EnerTech portfolio." actions={<Button size="sm">Add customer</Button>} />
      <div className="space-y-4 p-6">
        <Panel bodyClassName="p-0">
          <Toolbar placeholder="Search customers…" right={<Button size="sm" variant="outline">Export CSV</Button>} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>{["Company", "Primary contact", "Phone", "Email", "Installed base", "Owner"].map((h) => <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((l) => (
                  <tr key={l.id} className="hover:bg-secondary/40">
                    <td className="px-4 py-3 font-medium">{l.company}</td>
                    <td className="px-4 py-3">{l.name}</td>
                    <td className="num px-4 py-3 text-muted-foreground whitespace-nowrap">{l.phone}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.email}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.product}</td>
                    <td className="px-4 py-3">{l.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination total={412} shown={leads.length} />
        </Panel>
      </div>
    </>
  );
}
