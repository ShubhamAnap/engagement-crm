import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Pill, Toolbar, TablePagination, StatCard, ChannelIcon, ScoreBar, EmptyState } from "@/components/shared/ui-kit";
import { conversations, messages } from "@/data/mock";
import { Input } from "@/components/ui/input";
import { Sparkles, Send, Paperclip } from "lucide-react";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Omnichannel Inbox — EnerTech Engage" },
      { name: "description", content: "Every website, WhatsApp, email, Instagram and Facebook conversation in one shared workspace." },
      { property: "og:title", content: "Omnichannel Inbox — EnerTech Engage" },
      { property: "og:description", content: "Every website, WhatsApp, email, Instagram and Facebook conversation in one shared workspace." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Omnichannel Inbox" description="Every website, WhatsApp, email, Instagram and Facebook conversation in one shared workspace." actions={<Button size="sm">Compose</Button>} />
      <div className="space-y-4 p-6">
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
          <Panel title="Conversations" bodyClassName="p-0">
            <Toolbar placeholder="Search conversations…" />
            <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
              {["Unread", "Assigned", "Website", "WhatsApp", "Instagram", "Facebook", "Email"].map((f) => (
                <button key={f} className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground">{f}</button>
              ))}
            </div>
            <ul className="divide-y divide-border">
              {conversations.map((c, i) => (
                <li key={c.id} className={i === 0 ? "bg-secondary/70 px-3 py-3" : "px-3 py-3 hover:bg-secondary/40"}>
                  <div className="flex items-center gap-2">
                    <ChannelIcon channel={c.channel} className="shrink-0 text-muted-foreground" />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{c.customer}</p>
                    <span className="num shrink-0 text-[11px] text-muted-foreground">{c.time}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{c.preview}</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {c.tags.map((t) => <Pill key={t}>{t}</Pill>)}
                    {c.unread > 0 && <Pill tone="primary" className="ml-auto">{c.unread}</Pill>}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Rakesh Menon · Kerala Diagnostics" description="WhatsApp · CV-4821 · AI Sales Agent" bodyClassName="p-0">
            <div className="flex h-[520px] flex-col">
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.map((m) => (
                  <div key={m.id} className={m.from === "customer" ? "flex justify-start" : "flex justify-end"}>
                    <div className="max-w-[78%]">
                      <div className={m.from === "customer" ? "rounded-xl bg-secondary px-3 py-2 text-sm" : "rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground"}>
                        {m.text}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="num">{m.time}</span>
                        {"confidence" in m && m.confidence ? <Pill tone="success">conf {m.confidence}</Pill> : null}
                        {"sources" in m && m.sources ? <span className="truncate">{m.sources.join(" · ")}</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Rakesh is typing…</p>
              </div>
              <div className="border-t border-border p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs text-primary">
                  <Sparkles className="size-3.5" /> AI suggestion: send quotation QT-1182 with 12-battery configuration
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Attach"><Paperclip className="size-4" /></Button>
                  <Input className="h-9" placeholder="Write a reply…" aria-label="Reply" />
                  <Button size="icon" className="size-9 shrink-0" aria-label="Send"><Send className="size-4" /></Button>
                </div>
              </div>
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel title="Customer Profile">
              <dl className="space-y-2 text-sm">
                {[["Name", "Rakesh Menon"], ["Company", "Kerala Diagnostics"], ["Phone", "+91 98470 11234"], ["Email", "rakesh@keraladx.in"], ["Assigned", "Vikram S."]].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="truncate font-medium">{v}</dd></div>
                ))}
              </dl>
              <div className="mt-3"><p className="mb-1 text-xs text-muted-foreground">Lead score</p><ScoreBar score={92} /></div>
            </Panel>
            <Panel title="Conversation Summary">
              <p className="text-sm text-muted-foreground">Evaluating a 3 kVA online UPS for a diagnostics lab in Kochi. Wants 60+ minutes of backup; quotation requested for a 12-battery bank.</p>
            </Panel>
            <Panel title="Internal Notes">
              <p className="text-sm text-muted-foreground">Existing customer since 2023. Price sensitive — apply distributor slab B.</p>
            </Panel>
            <Panel title="Past Purchases" bodyClassName="p-0">
              <ul className="divide-y divide-border text-sm">
                <li className="flex justify-between px-4 py-2.5"><span>EN-1000X × 2</span><span className="num text-muted-foreground">2023</span></li>
                <li className="flex justify-between px-4 py-2.5"><span>EN-SMF42 × 8</span><span className="num text-muted-foreground">2024</span></li>
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
