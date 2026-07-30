import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — EnerTech Engage" },
      { name: "description", content: "Scheduled and ad-hoc reports across conversations, revenue, SLA and AI quality." },
      { property: "og:title", content: "Reports — EnerTech Engage" },
      { property: "og:description", content: "Scheduled and ad-hoc reports across conversations, revenue, SLA and AI quality." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Reports" description="Scheduled and ad-hoc reports across conversations, revenue, SLA and AI quality." actions={<Button size="sm">Build report</Button>} />
      <div className="space-y-4 p-6">
        <Panel bodyClassName="p-0">
          <Toolbar placeholder="Search reports…" right={<Button size="sm" variant="outline">Export all</Button>} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr>{["Report", "Owner", "Schedule", "Format", "Last run", "Status"].map((h) => <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {[
                  ["Weekly Conversation Summary", "Ananya Rao", "Mon 09:00", "PDF", "2d ago", "Delivered"],
                  ["Monthly Revenue & Pipeline", "Vikram S.", "1st 08:00", "XLSX", "12d ago", "Delivered"],
                  ["AI Quality & Hallucination Audit", "System", "Daily 23:00", "CSV", "9h ago", "Delivered"],
                  ["SLA Breach Report", "Meera J.", "Daily 18:00", "PDF", "1d ago", "Failed"],
                  ["Channel Health Digest", "System", "Fri 17:00", "PDF", "5d ago", "Delivered"],
                ].map((r) => (
                  <tr key={r[0]} className="hover:bg-secondary/40">
                    <td className="px-4 py-3 font-medium">{r[0]}</td><td className="px-4 py-3">{r[1]}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r[2]}</td><td className="px-4 py-3">{r[3]}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r[4]}</td>
                    <td className="px-4 py-3"><Pill tone={r[5] === "Delivered" ? "success" : "danger"}>{r[5]}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination total={12} shown={5} />
        </Panel>
      </div>
    </>
  );
}
