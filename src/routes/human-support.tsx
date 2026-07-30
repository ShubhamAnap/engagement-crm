import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";
import { handoffQueue } from "@/data/mock";
import { toast } from "sonner";

export const Route = createFileRoute("/human-support")({
  head: () => ({
    meta: [
      { title: "Human Support — EnerTech Engage" },
      { name: "description", content: "Handoff queue with takeover, transfer and resolution controls for the support desk." },
      { property: "og:title", content: "Human Support — EnerTech Engage" },
      { property: "og:description", content: "Handoff queue with takeover, transfer and resolution controls for the support desk." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Human Support" description="Handoff queue with takeover, transfer and resolution controls for the support desk." actions={<Button size="sm">Join queue</Button>} />
      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Waiting" value="2" hint="longest 12m" />
          <StatCard label="Assigned" value="1" hint="Vikram S." />
          <StatCard label="Working" value="1" hint="Meera J." />
          <StatCard label="Resolved Today" value="48" delta="+9" trend="up" />
        </div>
        <Panel title="Handoff Queue" bodyClassName="p-0">
          <Toolbar placeholder="Search queue…" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr>{["ID", "Customer", "Reason", "Priority", "Waiting", "State", "Agent", "Actions"].map((h) => <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {handoffQueue.map((q) => (
                  <tr key={q.id} className="hover:bg-secondary/40">
                    <td className="num px-4 py-3">{q.id}</td>
                    <td className="px-4 py-3"><p className="font-medium whitespace-nowrap">{q.customer}</p><p className="text-xs text-muted-foreground whitespace-nowrap">{q.company}</p></td>
                    <td className="px-4 py-3 text-muted-foreground">{q.reason}</td>
                    <td className="px-4 py-3"><Pill tone={q.priority === "High" ? "danger" : "neutral"}>{q.priority}</Pill></td>
                    <td className="num px-4 py-3">{q.waiting}</td>
                    <td className="px-4 py-3"><Pill tone={q.state === "Resolved" ? "success" : q.state === "Waiting" ? "warning" : "info"} dot>{q.state}</Pill></td>
                    <td className="px-4 py-3 whitespace-nowrap">{q.agent}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        <Button size="sm" className="h-7 text-xs" onClick={() => toast.success("Took over " + q.id)}>Take over</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toast("Transfer dialog opened")}>Transfer</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toast.success(q.id + " resolved")}>Resolve</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination total={5} shown={5} />
        </Panel>
      </div>
    </>
  );
}
