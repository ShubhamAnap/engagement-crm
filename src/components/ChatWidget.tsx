import { useEffect, useRef, useState } from "react";
import { Bot, Building2, ChevronDown, Headphones, Languages, Mail, MapPin, MessageSquare, Paperclip, Phone, RefreshCw, Send, Sparkles, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  widgetGetOrCreateConversation,
  widgetListMessages,
  widgetLookupVisitor,
  widgetSendMessage,
  widgetUploadAttachment,
} from "@/server/widget-chat";

type ServerMessage = { id: string; sender: string; body: string };
type UiMsg = { id: string; from: "bot" | "user"; text: string; kind?: "ai" | "agent" };
type VisitorProfile = { name: string; email: string; phone: string; company: string; location: string };

const SESSION_KEY = "enertech-widget-session";
const suggested = ["Which UPS suits a 3 kVA load?", "Battery runtime calculator", "Talk to a human", "I need a quotation"];
const welcome: UiMsg = {
  id: "welcome",
  from: "bot",
  text: "Hi 👋 I'm EnerBot, EnerTech's AI assistant. I can help with product selection, runtime calculations, service requests and quotations. Messages are saved to your EnerTech Engage inbox.",
};
const emptyProfile: VisitorProfile = { name: "", email: "", phone: "", company: "", location: "" };

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
  // Name + email + phone is enough to open chat; company/location enrich the lead.
  return Boolean(profile.name.trim() && profile.email.trim() && profile.phone.trim());
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

export function ChatWidget() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState("EN");
  const [msgs, setMsgs] = useState<UiMsg[]>([welcome]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [humanMode, setHumanMode] = useState(false);
  const [profile, setProfile] = useState<VisitorProfile>(emptyProfile);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef(profile);
  const lookedUpRef = useRef("");
  const busyRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const widgetKey = (import.meta.env.VITE_WIDGET_PUBLIC_KEY as string) || "";

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
    if (!widgetKey) throw new Error("Widget public key is missing. Check .env and restart the dev server.");
    const visitor = override ?? profileRef.current;
    const prevId = conversationIdRef.current;
    const convo = await widgetGetOrCreateConversation({
      data: {
        key: widgetKey,
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

    // Contact matched an existing Inbox thread — reload that history once.
    if (prevId !== nextId) {
      const history = (await widgetListMessages({
        data: { key: widgetKey, conversationId: nextId },
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
    setDetailsOpen(true);
    await syncConversationProfile(emptyProfile);
  }

  async function resumeOrStartConversation() {
    lookedUpRef.current = "";
    setProfile(emptyProfile);
    profileRef.current = emptyProfile;
    setDetailsOpen(true);
    const convoId = await syncConversationProfile(emptyProfile);
    const history = (await widgetListMessages({
      data: { key: widgetKey, conversationId: convoId },
    })) as ServerMessage[];
    setMsgs(applyHistory(history));
    setHumanMode(history.some((m) => m.sender === "agent") || false);
  }

  useEffect(() => {
    if (!open || !session) return;
    if (!widgetKey) {
      toast.error("Widget public key is missing. Check .env and restart the dev server.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Resume same browser session so human-agent replies stay visible.
        // Contact form still starts blank each open.
        await resumeOrStartConversation();
        if (cancelled) return;
      } catch (err) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Could not start chat session");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, session, widgetKey]);

  useEffect(() => {
    if (!open || !conversationId || !widgetKey) return;

    const poll = async () => {
      if (busyRef.current) return;
      try {
        const history = (await widgetListMessages({
          data: { key: widgetKey, conversationId },
        })) as ServerMessage[];
        setMsgs(applyHistory(history));
        if (history.some((m) => m.sender === "agent")) setHumanMode(true);
      } catch (err) {
        console.error(err);
      }
    };

    const timer = window.setInterval(() => void poll(), 2500);
    return () => window.clearInterval(timer);
  }, [open, conversationId, widgetKey]);

  useEffect(() => {
    if (!open || !session || !widgetKey) return;
    if (!hasIdentity(profile)) return;

    const lookupKey = `${profile.email.trim().toLowerCase()}|${profile.phone.trim()}`;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (lookedUpRef.current === lookupKey) return;
          const known = await widgetLookupVisitor({
            data: { key: widgetKey, email: profile.email, phone: profile.phone },
          });
          lookedUpRef.current = lookupKey;
          if (!known) return;

          const merged = mergeMissingFields(profileRef.current, known);
          setProfile(merged);
          profileRef.current = merged;
          if (isProfileComplete(merged)) setDetailsOpen(false);
          toast.message("Welcome back — we filled known details.");
        } catch (err) {
          console.error(err);
        }
      })();
    }, 500);

    return () => window.clearTimeout(timer);
  }, [profile.email, profile.phone, open, session, widgetKey]);

  useEffect(() => {
    if (!open || !session || !widgetKey) return;
    if (!hasIdentity(profile)) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const current = profileRef.current;
          await syncConversationProfile(current);
          if (isProfileComplete(current)) setDetailsOpen(false);
        } catch (err) {
          console.error(err);
        }
      })();
    }, 700);

    return () => window.clearTimeout(timer);
  }, [profile, open, session, widgetKey]);

  async function startNewConversation() {
    if (!session) {
      toast.error("Sign in to use the live widget preview");
      return;
    }
    if (!widgetKey) {
      toast.error("Widget public key is missing. Check .env and restart the dev server.");
      return;
    }
    if (busy) return;

    setBusy(true);
    try {
      await beginFreshConversation();
      toast.success("New chat started");
      setDetailsOpen(true);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Could not start a new chat");
    } finally {
      setBusy(false);
    }
  }

  const uploadFile = async (file: File) => {
    if (busy) return;
    if (!session) {
      toast.error("Sign in to use the live widget preview");
      return;
    }
    if (!widgetKey) {
      toast.error("Widget public key is missing.");
      return;
    }
    if (!isProfileComplete(profile)) {
      toast.error("Please fill Name, Email, and Phone before uploading");
      return;
    }

    setBusy(true);
    setTyping(true);
    try {
      let convoId = conversationId;
      if (!convoId) convoId = await syncConversationProfile(profile);
      else await syncConversationProfile(profile);

      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const base64 = btoa(binary);

      const result = await widgetUploadAttachment({
        data: {
          key: widgetKey,
          conversationId: convoId,
          fileName: file.name,
          mimeType: file.type || undefined,
          base64,
        },
      });
      setMsgs(applyHistory(result.messages as ServerMessage[]));
      if (result.aiPaused || result.status === "human" || result.status === "escalated") setHumanMode(true);
      toast.success("File shared with support");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setTyping(false);
      setBusy(false);
    }
  };

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    if (!session) {
      toast.error("Sign in to use the live widget preview");
      return;
    }
    if (!widgetKey) {
      toast.error("Widget public key is missing. Check .env and restart the dev server.");
      return;
    }
    if (!isProfileComplete(profile)) {
      setDetailsOpen(true);
      toast.error("Please share your name, email, and phone so we can help you.");
      return;
    }

    setBusy(true);
    const userText = text.trim();
    setDraft("");
    setMsgs((m) => [...m, { id: `local-${Date.now()}`, from: "user", text: userText }]);
    setTyping(true);

    try {
      let convoId = conversationId;
      if (!convoId) convoId = await syncConversationProfile(profile);
      else await syncConversationProfile(profile);
      const result = await widgetSendMessage({ data: { key: widgetKey, conversationId: convoId, body: userText } });
      setMsgs(applyHistory(result.messages as ServerMessage[]));
      if (result.aiPaused || result.status === "human" || result.status === "escalated") setHumanMode(true);
      setDetailsOpen(false);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setTyping(false);
      setBusy(false);
    }
  };

  return (
    <>
      {open && (
        <div className="fixed right-2 bottom-[4.75rem] z-50 flex h-[min(640px,calc(100dvh-6.5rem))] w-[min(384px,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl sm:right-4 sm:bottom-20">
          <header className="flex items-center gap-2.5 border-b border-border bg-secondary/50 px-3.5 py-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">EnerBot · EnerTech</p>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={cn("size-1.5 rounded-full", humanMode ? "bg-warning" : "bg-success")} />
                {humanMode ? "Connected with our support team" : "Online · usually replies instantly"}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-1.5 text-[11px]"
                onClick={() => void startNewConversation()}
                disabled={busy}
                aria-label="Start new conversation"
                title="Start new conversation (keeps previous chat in Inbox)"
              >
                <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> New
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-1.5 text-[11px]"
                onClick={() => setLang((l) => (l === "EN" ? "HI" : l === "HI" ? "TA" : "EN"))}
                aria-label="Switch language"
              >
                <Languages className="size-3.5" /> {lang}
              </Button>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setOpen(false)} aria-label="Close chat">
                <X className="size-4" />
              </Button>
            </div>
          </header>

          <div className="border-b border-border bg-secondary/20 px-3.5 py-2">
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left text-xs font-medium text-muted-foreground"
              onClick={() => setDetailsOpen((o) => !o)}
              aria-expanded={detailsOpen}
            >
              <User className="size-3.5 shrink-0" />
              <span className="flex-1">
                {isProfileComplete(profile) ? "Your contact details" : "Share your contact (name, email, phone)"}
              </span>
              <ChevronDown className={cn("size-3.5 transition-transform", detailsOpen && "rotate-180")} />
            </button>
            {detailsOpen ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
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
                  <Input value={profile.phone} onChange={(e) => setProfile((s) => ({ ...s, phone: e.target.value }))} placeholder="Phone" className="h-8 pl-8 text-xs" />
                </div>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={profile.company} onChange={(e) => setProfile((s) => ({ ...s, company: e.target.value }))} placeholder="Company (optional)" className="h-8 pl-8 text-xs" />
                </div>
                <div className="relative sm:col-span-2">
                  <MapPin className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={profile.location} onChange={(e) => setProfile((s) => ({ ...s, location: e.target.value }))} placeholder="Location (optional)" className="h-8 pl-8 text-xs" />
                </div>
              </div>
            ) : null}
          </div>

          {humanMode ? (
            <div className="border-b border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-950 dark:text-amber-100">
              You’re chatting with our support team — keep messaging here.
            </div>
          ) : null}

          <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
            {msgs.map((m) => (
              <div key={m.id} className={cn("flex gap-2", m.from === "user" ? "justify-end" : "justify-start")}>
                {m.from === "bot" && (
                  <div className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
                    <Bot className="size-3.5" />
                  </div>
                )}
                <div className={cn("max-w-[80%] space-y-1", m.from === "user" && "items-end")}>
                  {m.kind === "agent" ? <p className="px-1 text-[10px] font-medium text-muted-foreground">Support team</p> : null}
                  <div
                    className={cn(
                      "rounded-xl px-3 py-2 text-sm leading-relaxed",
                      m.from === "user"
                        ? "bg-primary text-primary-foreground"
                        : m.kind === "agent"
                          ? "border border-primary/30 bg-primary/10 text-foreground"
                          : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {m.text}
                  </div>
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
                    <span key={d} className="size-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${d}ms` }} />
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
                type="button"
                onClick={() => void send(s)}
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
              void send(draft);
            }}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label="Attach file"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="size-4" />
            </Button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="image/*,.pdf,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void uploadFile(file);
              }}
            />
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about products, service or pricing…" className="h-9" aria-label="Message" disabled={busy} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label="Talk to a human"
              disabled={busy}
              onClick={() => void send("Please connect me to a human support agent")}
            >
              <Headphones className="size-4" />
            </Button>
            <Button type="submit" size="icon" className="size-8 shrink-0" aria-label="Send" disabled={busy}>
              <Send className="size-4" />
            </Button>
          </form>
        </div>
      )}

      <Button
        onClick={() => setOpen((v) => !v)}
        className="fixed right-2 bottom-3 z-50 h-11 gap-2 rounded-full pr-4 shadow-lg sm:right-4 sm:bottom-4 sm:h-12 sm:pr-5"
        aria-label="Open customer chat widget"
      >
        {open ? <X className="size-5" /> : <MessageSquare className="size-5" />}
        <span className="text-sm">{open ? "Close" : "Website chat"}</span>
      </Button>
    </>
  );
}
