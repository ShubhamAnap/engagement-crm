import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";
import { AlertTriangle, BookOpen, Brain, Target } from "lucide-react";

export const Route = createFileRoute("/ai-chat")({
  head: () => ({
    meta: [
      { title: "AI Chat Support — EnerTech Engage" },
      { name: "description", content: "Inspect what the AI retrieved, remembered and reasoned before every answer it sent." },
      { property: "og:title", content: "AI Chat Support — EnerTech Engage" },
      { property: "og:description", content: "Inspect what the AI retrieved, remembered and reasoned before every answer it sent." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="AI Chat Support" description="Inspect what the AI retrieved, remembered and reasoned before every answer it sent." actions={<Button size="sm">Open playground</Button>} />
      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Answers Today" value="1,284" delta="+8.1%" trend="up" icon={Brain} />
          <StatCard label="Grounded Answers" value="96.2%" delta="+1.1pt" trend="up" icon={BookOpen} />
          <StatCard label="Hallucination Flags" value="7" delta="-3" trend="down" icon={AlertTriangle} />
          <StatCard label="Lead Conversions" value="118" delta="+14" trend="up" icon={Target} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Answer Inspector" description="CV-4821 · message #4">
            <p className="rounded-lg bg-secondary p-3 text-sm">12 × 42Ah in the same string configuration gives roughly 68–74 minutes at the same load.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-2.5"><p className="text-[11px] uppercase text-muted-foreground">Confidence</p><p className="num text-lg font-semibold text-success">0.91</p></div>
              <div className="rounded-lg border border-border p-2.5"><p className="text-[11px] uppercase text-muted-foreground">Hallucination risk</p><p className="num text-lg font-semibold">Low</p></div>
            </div>
            <p className="mt-3 text-xs uppercase text-muted-foreground">Retrieved documents</p>
            <ul className="mt-1.5 space-y-1.5 text-sm">
              <li className="flex justify-between rounded-lg border border-border px-3 py-2"><span>Battery Runtime Matrix 2026</span><Pill tone="success">0.94</Pill></li>
              <li className="flex justify-between rounded-lg border border-border px-3 py-2"><span>EN-3000X Datasheet v4.2</span><Pill tone="success">0.89</Pill></li>
              <li className="flex justify-between rounded-lg border border-border px-3 py-2"><span>SMF Battery Ageing Guide</span><Pill tone="warning">0.62</Pill></li>
            </ul>
          </Panel>
          <div className="space-y-4">
            <Panel title="Reasoning Trace">
              <ol className="space-y-2 text-sm text-muted-foreground">
                <li>1. Identified load 1.8 kW at 60% of 3 kVA rating.</li>
                <li>2. Mapped 12 × 42Ah to 96V string with 1.5× capacity factor.</li>
                <li>3. Cross-checked runtime matrix row R-14 at 25°C.</li>
                <li>4. Applied 8% ageing derate for 2-year-old batteries.</li>
              </ol>
            </Panel>
            <Panel title="Memory">
              <p className="text-sm text-muted-foreground">Remembers: Kochi site, existing EN-1000X units, distributor slab B, prefers WhatsApp.</p>
            </Panel>
            <Panel title="Product Recommendation">
              <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">EN-3000X + 12 × EN-SMF42</p><p className="text-xs text-muted-foreground">Recommendation weight 0.94</p></div><Pill tone="primary">₹1,02,340</Pill></div>
            </Panel>
            <Panel title="Suggested Next Action">
              <div className="flex flex-wrap gap-2"><Button size="sm">Send quotation</Button><Button size="sm" variant="outline">Schedule site visit</Button><Button size="sm" variant="outline">Escalate to human</Button></div>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
