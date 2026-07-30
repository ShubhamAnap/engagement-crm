import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Activity,
  Bot,
  Hand,
  Pause,
  Play,
  ShieldAlert,
  Timer,
  UserPlus,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  ChannelIcon,
  PageHeader,
  Panel,
  Pill,
  StatCard,
  Toolbar,
} from "@/components/shared/ui-kit";
import { liveAiSessions } from "@/data/mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/command-center")({
  head: () => ({
    meta: [
      { title: "AI Command Center — EnerTech Engage" },
      {
        name: "description",
        content:
          "Real-time monitoring of live AI conversations: confidence, knowledge sources, memory, tokens, latency and escalations.",
      },
      { property: "og:title", content: "AI Command Center — EnerTech Engage" },
      {
        property: "og:description",
        content: "Real-time monitoring and control of live AI conversations.",
      },
    ],
  }),
  component: CommandCenter,
});

const timeline = [
  { t: "10:02:04", label: "Session opened", detail: "WhatsApp · +91 98470 11234", tone: "neutral" as const },
  { t: "10:02:06", label: "Intent classified", detail: "product_sizing (0.96)", tone: "info" as const },
  { t: "10:02:07", label: "Knowledge retrieved", detail: "3 chunks · EN-3000X Datasheet v4.2", tone: "primary" as const },
  { t: "10:02:09", label: "Response generated", detail: "740ms · 1,120 tokens · confidence 0.94", tone: "success" as const },
  { t: "10:04:41", label: "Lead qualified", detail: "Score 92 · pushed to CRM as LD-2201", tone: "success" as const },
  { t: "10:06:12", label: "Quotation requested", detail: "Handed to Quotation Agent", tone: "warning" as const },
];

function CommandCenter() {
  const [selected, setSelected] = useState(liveAiSessions[0].id);
  const [paused, setPaused] = useState(false);
  const session = liveAiSessions.find((s) => s.id === selected)!;

  return (
    <>
      <PageHeader
        title="AI Command Center"
        description="Live supervision of every AI conversation with instant human override."
        meta={
          <>
            <Pill tone="success" dot>
              {liveAiSessions.length} live sessions
            </Pill>
            <Pill tone="warning">1 escalation triggered</Pill>
          </>
        }
        actions={
          <Button
            variant={paused ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setPaused((p) => !p);
              toast(paused ? "AI resumed globally" : "AI paused globally");
            }}
          >
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            {paused ? "Resume all AI" : "Pause all AI"}
          </Button>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Live Sessions" value="5" hint="across 4 channels" icon={Activity} />
          <StatCard label="Avg. Confidence" value="0.75" delta="-0.06" trend="down" hint="rolling 15 min" icon={Zap} />
          <StatCard label="Avg. Latency" value="1.22s" delta="+180ms" trend="up" hint="p50 generation" icon={Timer} />
          <StatCard label="Escalations" value="1" hint="awaiting takeover" icon={ShieldAlert} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <Panel title="Live AI Conversations" bodyClassName="p-0">
            <Toolbar placeholder="Search live sessions…" />
            <ul className="divide-y divide-border">
              {liveAiSessions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => setSelected(s.id)}
                    className={cn(
                      "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50",
                      selected === s.id && "bg-secondary/70",
                    )}
                  >
                    <ChannelIcon channel={s.channel} className="text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {s.customer}{" "}
                        <span className="num text-xs font-normal text-muted-foreground">
                          · {s.id}
                        </span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.agent} · {s.sources} sources · {s.tokens.toLocaleString()} tokens
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Pill
                        tone={s.confidence >= 0.8 ? "success" : s.confidence >= 0.6 ? "warning" : "danger"}
                      >
                        {s.confidence.toFixed(2)}
                      </Pill>
                      <span className="num w-14 text-right text-xs text-muted-foreground">
                        {s.latency}ms
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="space-y-4">
            <Panel
              title={`Session ${session.id}`}
              description={`${session.customer} · ${session.agent}`}
              action={
                <Pill tone={session.escalation === "None" ? "success" : "danger"} dot>
                  {session.escalation === "None" ? "Healthy" : session.escalation}
                </Pill>
              }
            >
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Current AI Agent", session.agent],
                  ["Customer", session.customer],
                  ["Memory Status", session.memory],
                  ["Knowledge Sources", `${session.sources} documents`],
                  ["Token Usage", session.tokens.toLocaleString()],
                  ["Latency", `${session.latency} ms`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-border bg-secondary/40 p-2.5">
                    <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{k}</dt>
                    <dd className="mt-0.5 truncate text-sm font-medium">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Confidence score</span>
                  <span className="num font-medium">{(session.confidence * 100).toFixed(0)}%</span>
                </div>
                <Progress value={session.confidence * 100} className="h-1.5" />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" className="gap-1.5" onClick={() => toast.success(`You took over ${session.id}`)}>
                  <Hand className="size-4" /> Take over
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => toast("AI paused for this session")}>
                  <Pause className="size-4" /> Pause AI
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => toast("AI resumed")}>
                  <Play className="size-4" /> Resume AI
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => toast("Assigned to Vikram S.")}>
                  <UserPlus className="size-4" /> Assign human
                </Button>
              </div>
            </Panel>

            <Panel title="Conversation Timeline" bodyClassName="p-0">
              <ol className="relative px-4 py-3">
                {timeline.map((e, i) => (
                  <li key={e.t} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < timeline.length - 1 && (
                      <span className="absolute top-4 left-[7px] h-full w-px bg-border" />
                    )}
                    <span
                      className={cn(
                        "z-10 mt-1.5 size-3.5 shrink-0 rounded-full border-2 border-background",
                        e.tone === "success" && "bg-success",
                        e.tone === "warning" && "bg-warning",
                        e.tone === "info" && "bg-info",
                        e.tone === "primary" && "bg-primary",
                        e.tone === "neutral" && "bg-muted-foreground",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{e.label}</p>
                      <p className="truncate text-xs text-muted-foreground">{e.detail}</p>
                    </div>
                    <span className="num ml-auto shrink-0 text-[11px] text-muted-foreground">
                      {e.t}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title="Active Agent" bodyClassName="p-4">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-lg bg-primary/15 text-primary">
                  <Bot className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{session.agent}</p>
                  <p className="text-xs text-muted-foreground">
                    gpt-5.6-sol · memory {session.memory.toLowerCase()} · RAG enabled
                  </p>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}