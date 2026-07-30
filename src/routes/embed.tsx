import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bot, Building2, Mail, MapPin, MessageSquare, Phone, RefreshCw, Palette, Send, Sparkles, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { COLOR_PALETTES, useTheme } from "@/lib/theme";
import {
  widgetGetOrCreateConversation,
  widgetListMessages,
  widgetLookupVisitor,
  widgetSendMessage,
} from "@/server/widget-chat";

const SESSION_KEY = "enertech-embed-session";

type ServerMessage = { id: string; sender: string; body: string };
type UiMsg = { id: string; from: "bot" | "user"; text: string; kind?: "ai" | "agent" };
type VisitorProfile = { name: string; email: string; phone: string; company: string; location: string };

const welcome: UiMsg = {
  id: "welcome",
  from: "bot",
  text: "Hi 👋 I'm EnerBot from EnerTech UPS. Ask about products, runtime, service, or request a quotation.",
};

const emptyProfile: VisitorProfile = { name: "", email: "", phone: "", company: "", location: "" };

export const Route = createFileRoute("/embed")({
  validateSearch: (search: Record<string, unknown>) => ({ key: typeof search.key === "string" ? search.key : "" }),
  head: () => ({ meta: [{ title: "EnerBot — EnerTech" }] }),
  component: EmbedChat,
});

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function rotateSessionId() {
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

function isProfileComplete(profile: VisitorProfile) {
  return Boolean(
    profile.name.trim() &&
      profile.email.trim() &&
      profile.phone.trim() &&
      profile.company.trim() &&
      profile.location.trim(),
  );
}

function hasIdentity(profile: VisitorProfile) {
  return Boolean(profile.email.trim() || profile.phone.trim());
}

function mergeMissingFields(current: VisitorProfile, known: Partial<VisitorProfile>): VisitorProfile {
  return {
    name: current.name.trim() || known.name?.trim() || "",
    email: current.email.trim() || known.email?.trim() || "",
    phone: current.phone.trim() || known.phone?.trim() || "",
    company: current.company.trim() || known.company?.trim() || "",
    location: current.location.trim() || known.location?.trim() || "",
  };
}

function toUi(messages: ServerMessage[]): UiMsg[] {
  return messages.map((m) => ({
    id: m.id,
    from: m.sender === "customer" ? "user" : "bot",
    text: m.body,
    kind: m.sender === "agent" ? "agent" : m.sender === "ai" ? "ai" : undefined,
  }));
}

function applyHistory(messages: ServerMessage[]): UiMsg[] {
  return messages.length ? [welcome, ...toUi(messages)] : [welcome];
}

function EmbedChat() {
  const { key } = Route.useSearch();
  const { palette, setPalette } = useTheme();
  const [open, setOpen] = useState(true);
  const [msgs, setMsgs] = useState<UiMsg[]>([welcome]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [humanMode, setHumanMode] = useState(false);
  const [profile, setProfile] = useState<VisitorProfile>(emptyProfile);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef(profile);
  const lookedUpRef = useRef("");
  const busyRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    busyRef.current = busy || typing;
  }, [busy, typing]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, typing, open]);

  async function syncConversationProfile(override?: VisitorProfile) {
    if (!key) return null;
    const visitor = override ?? profileRef.current;
    const prevId = conversationIdRef.current;
    const convo = await widgetGetOrCreateConversation({
      data: {
        key,
        sessionId: getSessionId(),
        visitorName: visitor.name,
        visitorEmail: visitor.email,
        visitorPhone: visitor.phone,
        visitorCompany: visitor.company,
        visitorLocation: visitor.location,
      },
    });
    const nextId = convo.id as string;
    setConversationId(nextId);
    conversationIdRef.current = nextId;
    if (convo.status === "human" || convo.status === "escalated") setHumanMode(true);

    if (prevId !== nextId) {
      const history = (await widgetListMessages({
        data: { key, conversationId: nextId },
      })) as ServerMessage[];
      setMsgs(applyHistory(history));
      setHumanMode(history.some((m) => m.sender === "agent") || convo.status === "human" || convo.status === "escalated");
    }
    return nextId;
  }

  async function beginFreshConversation() {
    rotateSessionId();
    lookedUpRef.current = "";
    setHumanMode(false);
    setProfile(emptyProfile);
    profileRef.current = emptyProfile;
    setConversationId(null);
    conversationIdRef.current = null;
    setMsgs([welcome]);
    setDraft("");
    setTyping(false);
    setSaveHint(null);
    await syncConversationProfile(emptyProfile);
  }

  async function resumeOrStartConversation() {
    lookedUpRef.current = "";
    setProfile(emptyProfile);
    profileRef.current = emptyProfile;
    setSaveHint(null);
    const convoId = await syncConversationProfile(emptyProfile);
    if (!convoId || !key) return;
    const history = (await widgetListMessages({
      data: { key, conversationId: convoId },
    })) as ServerMessage[];
    setMsgs(applyHistory(history));
    setHumanMode(history.some((m) => m.sender === "agent"));
  }

  useEffect(() => {
    if (!key) {
      setError("Missing widget key");
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        await resumeOrStartConversation();
        if (cancelled) return;
        setError(null);
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : "Failed to start chat");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (!key || !open || !conversationId) return;

    const poll = async () => {
      if (busyRef.current) return;
      try {
        const history = (await widgetListMessages({
          data: { key, conversationId },
        })) as ServerMessage[];
        setMsgs(applyHistory(history));
        if (history.some((m) => m.sender === "agent")) setHumanMode(true);
      } catch (err) {
        console.error(err);
      }
    };

    const timer = window.setInterval(() => void poll(), 2500);
    return () => window.clearInterval(timer);
  }, [key, open, conversationId]);

  useEffect(() => {
    if (!key || !open) return;
    if (!hasIdentity(profile)) return;

    const lookupKey = `${profile.email.trim().toLowerCase()}|${profile.phone.trim()}`;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (lookedUpRef.current === lookupKey) return;
          const known = await widgetLookupVisitor({
            data: { key, email: profile.email, phone: profile.phone },
          });
          lookedUpRef.current = lookupKey;
          if (!known) return;
          const merged = mergeMissingFields(profileRef.current, known);
          setProfile(merged);
          profileRef.current = merged;
          setSaveHint("Known contact found — only missing fields needed");
        } catch (err) {
          console.error(err);
        }
      })();
    }, 500);

    return () => window.clearTimeout(timer);
  }, [profile.email, profile.phone, key, open]);

  useEffect(() => {
    if (!key || !open) return;
    if (!hasIdentity(profile)) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const current = profileRef.current;
          await syncConversationProfile(current);
          setSaveHint(isProfileComplete(current) ? "Details saved" : "Partial details auto-saved");
          setError(null);
        } catch (err) {
          console.error(err);
        }
      })();
    }, 700);

    return () => window.clearTimeout(timer);
  }, [profile, key, open]);

  async function startNewConversation() {
    if (!key || busy) return;
    setBusy(true);
    try {
      await beginFreshConversation();
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Could not start a new chat");
    } finally {
      setBusy(false);
    }
  }

  async function send(text: string) {
    if (!text.trim() || busy || !key) return;
    if (!isProfileComplete(profile)) {
      setError("Please fill Name, Email, Phone, Company, and Location before chatting");
      return;
    }
    setBusy(true);
    setTyping(true);
    const userText = text.trim();
    setDraft("");
    setMsgs((m) => [...m, { id: `local-${Date.now()}`, from: "user", text: userText }]);

    try {
      let convoId = conversationId;
      if (!convoId) convoId = await syncConversationProfile(profile);
      else await syncConversationProfile(profile);
      if (!convoId) throw new Error("Conversation not ready");
      const result = await widgetSendMessage({ data: { key, conversationId: convoId, body: userText } });
      setMsgs(applyHistory(result.messages as ServerMessage[]));
      if (result.aiPaused || result.status === "human" || result.status === "escalated") setHumanMode(true);
      setSaveHint("Details saved");
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setTyping(false);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex min-h-screen items-end justify-end bg-transparent p-3">
        <Button
          onClick={() => {
            setOpen(true);
            void startNewConversation();
          }}
          className="h-12 gap-2 rounded-full pr-5 shadow-lg"
          aria-label="Open chat"
        >
          <MessageSquare className="size-5" />
          Chat with EnerTech
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-stretch justify-center bg-transparent p-0 sm:items-end sm:justify-end sm:p-3">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden border border-border bg-card shadow-2xl sm:h-[640px] sm:w-[384px] sm:rounded-xl">
        <header className="flex items-center gap-2.5 border-b border-border bg-secondary/50 px-3.5 py-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">EnerBot · EnerTech</p>
            <p className="text-[11px] text-muted-foreground">
              {humanMode ? "Human agent connected · AI paused" : "We typically reply instantly"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7" aria-label="Choose color theme" title="Color theme">
                  <Palette className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Color theme</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COLOR_PALETTES.map((item) => (
                  <DropdownMenuItem key={item.id} onSelect={() => setPalette(item.id)}>
                    <span className="size-3.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: item.swatch }} aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    {palette === item.id ? <span className="text-[10px] text-muted-foreground">Active</span> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-1.5 text-[11px]"
              onClick={() => void startNewConversation()}
              disabled={busy}
              aria-label="Start new conversation"
              title="Start new conversation"
            >
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> New
            </Button>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setOpen(false)} aria-label="Minimize">
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {error && <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

        <div className="border-b border-border bg-secondary/20 px-3.5 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Enter contact details (auto-saved)</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="relative">
              <User className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={profile.name} onChange={(e) => setProfile((s) => ({ ...s, name: e.target.value }))} placeholder="Name" className="h-8 pl-8 text-xs" />
            </div>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={profile.email} onChange={(e) => setProfile((s) => ({ ...s, email: e.target.value }))} placeholder="Email" className="h-8 pl-8 text-xs" />
            </div>
            <div className="relative">
              <Phone className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={profile.phone} onChange={(e) => setProfile((s) => ({ ...s, phone: e.target.value }))} placeholder="Phone Number" className="h-8 pl-8 text-xs" />
            </div>
            <div className="relative">
              <Building2 className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={profile.company} onChange={(e) => setProfile((s) => ({ ...s, company: e.target.value }))} placeholder="Company name" className="h-8 pl-8 text-xs" />
            </div>
            <div className="relative sm:col-span-2">
              <MapPin className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={profile.location} onChange={(e) => setProfile((s) => ({ ...s, location: e.target.value }))} placeholder="Location" className="h-8 pl-8 text-xs" />
            </div>
          </div>
          {saveHint ? <p className="mt-2 text-[11px] text-muted-foreground">{saveHint}</p> : null}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
          {msgs.map((m) => (
            <div key={m.id} className={cn("flex gap-2", m.from === "user" ? "justify-end" : "justify-start")}>
              {m.from === "bot" && (
                <div className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
                  <Bot className="size-3.5" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[80%] space-y-1 rounded-xl px-3 py-2 text-sm leading-relaxed",
                  m.from === "user"
                    ? "bg-primary text-primary-foreground"
                    : m.kind === "agent"
                      ? "border border-primary/30 bg-primary/10 text-foreground"
                      : "bg-secondary text-secondary-foreground",
                )}
              >
                {m.kind === "agent" ? <p className="mb-1 text-[10px] font-medium opacity-70">Human agent</p> : null}
                {m.text}
              </div>
            </div>
          ))}
          {typing && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Bot className="size-3.5" /> EnerBot is typing…
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="flex items-center gap-1.5 border-t border-border p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type your message…" className="h-9" disabled={busy || !key} />
          <Button type="submit" size="icon" className="size-8 shrink-0" disabled={busy || !draft.trim()}>
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
