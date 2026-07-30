import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Headphones,
  Languages,
  Paperclip,
  Send,
  Sparkles,
  X,
  MessageSquare,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Msg = {
  id: number;
  from: "bot" | "user";
  text: string;
  card?: { name: string; spec: string; price: string };
  file?: string;
};

const suggested = [
  "Which UPS suits a 3 kVA load?",
  "Battery runtime calculator",
  "Book a site visit",
  "Download EN-5000X datasheet",
];

const initial: Msg[] = [
  {
    id: 1,
    from: "bot",
    text: "Hi 👋 I'm EnerBot, EnerTech's AI assistant. I can help with product selection, runtime calculations, service requests and quotations.",
  },
];

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState("EN");
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, typing, open]);

  const send = (text: string) => {
    if (!text.trim()) return;
    const id = Date.now();
    setMsgs((m) => [...m, { id, from: "user", text }]);
    setDraft("");
    setTyping(true);
    window.setTimeout(() => {
      setTyping(false);
      setMsgs((m) => [
        ...m,
        {
          id: id + 1,
          from: "bot",
          text: "Based on a 3 kVA critical load, the EN-3000X online UPS with 8 × 42Ah batteries gives ~45 minutes of backup at 60% load. Here's the recommended configuration:",
          card: {
            name: "EnerTech EN-3000X",
            spec: "3 kVA · Online double conversion · 45 min @ 60%",
            price: "₹52,900",
          },
        },
      ]);
    }, 1100);
  };

  return (
    <>
      {open && (
        <div className="fixed right-4 bottom-20 z-50 flex h-[560px] w-[min(384px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <header className="flex items-center gap-2.5 border-b border-border bg-secondary/50 px-3.5 py-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">EnerBot Assistant</p>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-success" /> Typically replies instantly
              </p>
            </div>
            <div className="ml-auto flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-1.5 text-[11px]"
                onClick={() => setLang((l) => (l === "EN" ? "HI" : l === "HI" ? "TA" : "EN"))}
                aria-label="Switch language"
              >
                <Languages className="size-3.5" /> {lang}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
              >
                <X className="size-4" />
              </Button>
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
            {msgs.map((m) => (
              <div
                key={m.id}
                className={cn("flex gap-2", m.from === "user" ? "justify-end" : "justify-start")}
              >
                {m.from === "bot" && (
                  <div className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
                    <Bot className="size-3.5" />
                  </div>
                )}
                <div className={cn("max-w-[80%] space-y-2", m.from === "user" && "items-end")}>
                  <div
                    className={cn(
                      "rounded-xl px-3 py-2 text-sm leading-relaxed",
                      m.from === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {m.text}
                  </div>
                  {m.card && (
                    <div className="rounded-xl border border-border bg-background p-3">
                      <div className="aspect-[16/7] w-full rounded-lg border border-border bg-gradient-to-br from-secondary to-muted" />
                      <p className="mt-2 text-sm font-semibold">{m.card.name}</p>
                      <p className="text-xs text-muted-foreground">{m.card.spec}</p>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <span className="num text-sm font-semibold">{m.card.price}</span>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
                            <FileText className="size-3.5" /> PDF
                          </Button>
                          <Button size="sm" className="h-7 text-xs">
                            Get quote
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {typing && (
              <div className="flex items-center gap-2">
                <div className="grid size-6 place-items-center rounded-md bg-primary/15 text-primary">
                  <Bot className="size-3.5" />
                </div>
                <div className="flex gap-1 rounded-xl bg-secondary px-3 py-2.5">
                  {[0, 150, 300].map((d) => (
                    <span
                      key={d}
                      className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-border px-3.5 py-2">
            {suggested.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>

          <form
            className="flex items-center gap-1.5 border-t border-border p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label="Attach file"
              onClick={() => toast("File upload opened")}
            >
              <Paperclip className="size-4" />
            </Button>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about products, service or pricing…"
              className="h-9"
              aria-label="Message"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label="Talk to a human"
              onClick={() => toast.success("Connecting you to a support executive…")}
            >
              <Headphones className="size-4" />
            </Button>
            <Button type="submit" size="icon" className="size-8 shrink-0" aria-label="Send">
              <Send className="size-4" />
            </Button>
          </form>
        </div>
      )}

      <Button
        onClick={() => setOpen((v) => !v)}
        className="fixed right-4 bottom-4 z-50 h-12 gap-2 rounded-full pr-5 shadow-lg"
        aria-label="Preview customer chat widget"
      >
        {open ? <X className="size-5" /> : <MessageSquare className="size-5" />}
        <span className="text-sm">{open ? "Close" : "Widget preview"}</span>
      </Button>
    </>
  );
}