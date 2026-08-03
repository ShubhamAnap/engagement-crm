import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, Mail, MapPin, Phone, RefreshCw, Send, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  widgetGetOrCreateConversation,
  widgetListMessages,
  widgetLookupVisitor,
  widgetSendMessage,
} from "@/server/widget-chat";

const SESSION_KEY = "enertech-embed-session";
const PROFILE_KEY = "enertech-embed-profile";
const BRAND = "#0B2388";
const INK = "#FFFFFF";

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

function loadStoredProfile(): VisitorProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return emptyProfile;
    const parsed = JSON.parse(raw) as Partial<VisitorProfile>;
    return {
      name: String(parsed.name || ""),
      email: String(parsed.email || ""),
      phone: String(parsed.phone || ""),
      company: String(parsed.company || ""),
      location: String(parsed.location || ""),
    };
  } catch {
    return emptyProfile;
  }
}

function persistProfile(profile: VisitorProfile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function isProfileComplete(profile: VisitorProfile) {
  return Boolean(
    profile.name.trim() &&
      profile.email.trim() &&
      profile.phone.trim() &&
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
  const stored = loadStoredProfile();
  const [open, setOpen] = useState(true);
  const [msgs, setMsgs] = useState<UiMsg[]>([welcome]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [humanMode, setHumanMode] = useState(false);
  const [profile, setProfile] = useState<VisitorProfile>(stored);
  const [editingContact, setEditingContact] = useState(!isProfileComplete(stored));
  const endRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef(profile);
  const lookedUpRef = useRef("");
  const busyRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  const profileReady = isProfileComplete(profile);
  const showContactForm = editingContact || !profileReady;

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
  }, [msgs, typing, open, showContactForm]);

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
    // Keep known contact for returning visitor; only clear chat thread.
    const keep = isProfileComplete(profileRef.current) ? profileRef.current : emptyProfile;
    setProfile(keep);
    profileRef.current = keep;
    setConversationId(null);
    conversationIdRef.current = null;
    setMsgs([welcome]);
    setDraft("");
    setTyping(false);
    setEditingContact(!isProfileComplete(keep));
    await syncConversationProfile(keep);
  }

  async function resumeOrStartConversation() {
    const initial = loadStoredProfile();
    setProfile(initial);
    profileRef.current = initial;
    setEditingContact(!isProfileComplete(initial));
    lookedUpRef.current = "";
    const convoId = await syncConversationProfile(initial);
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
    if (!key || !open || !conversationId || showContactForm) return;

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
  }, [key, open, conversationId, showContactForm]);

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
          persistProfile(merged);
          if (isProfileComplete(merged) && !editingContact) setEditingContact(false);
        } catch (err) {
          console.error(err);
        }
      })();
    }, 500);

    return () => window.clearTimeout(timer);
  }, [profile.email, profile.phone, key, open, editingContact]);

  async function saveContactAndContinue() {
    if (!isProfileComplete(profile)) {
      setError("Please fill Name, Email, Phone, and Location to continue.");
      return;
    }
    setBusy(true);
    try {
      persistProfile(profile);
      profileRef.current = profile;
      await syncConversationProfile(profile);
      setEditingContact(false);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Could not save details");
    } finally {
      setBusy(false);
    }
  }

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
      setEditingContact(true);
      setError("Please share your name, email, phone, and location so we can help you.");
      return;
    }
    setBusy(true);
    setTyping(true);
    const userText = text.trim();
    setDraft("");
    setMsgs((m) => [...m, { id: `local-${Date.now()}`, from: "user", text: userText }]);

    try {
      persistProfile(profile);
      let convoId = conversationId;
      if (!convoId) convoId = await syncConversationProfile(profile);
      else await syncConversationProfile(profile);
      if (!convoId) throw new Error("Conversation not ready");
      const result = await widgetSendMessage({ data: { key, conversationId: convoId, body: userText } });
      setMsgs(applyHistory(result.messages as ServerMessage[]));
      if (result.aiPaused || result.status === "human" || result.status === "escalated") setHumanMode(true);
      setEditingContact(false);
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
          onClick={() => setOpen(true)}
          className="h-[72px] w-[72px] flex-col gap-0.5 rounded-full border-2 border-white px-2 text-white shadow-lg hover:opacity-95"
          style={{ backgroundColor: BRAND }}
          aria-label="ASK EnerTech"
        >
          <span className="text-[13px] font-extrabold tracking-wide leading-none">ASK</span>
          <span className="text-[9px] font-semibold leading-none opacity-95">EnerTech</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-stretch justify-center bg-transparent p-0 sm:items-end sm:justify-end sm:p-3">
      <div
        className="flex h-[100dvh] w-full flex-col overflow-hidden border shadow-2xl sm:h-[640px] sm:w-[384px] sm:rounded-xl"
        style={{ borderColor: BRAND, backgroundColor: INK, color: BRAND }}
      >
        <header
          className="flex items-center gap-2.5 px-3.5 py-3 text-white"
          style={{ backgroundColor: BRAND }}
        >
          <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-white">
            <img src="/favicon-32.png" alt="" className="size-7 object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">EnerTech</p>
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            {profileReady && !showContactForm ? (
              <button
                type="button"
                className="px-1 text-[10px] font-medium text-white/80 underline-offset-2 hover:text-white hover:underline"
                onClick={() => setEditingContact(true)}
              >
                Edit
              </button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-1.5 text-[11px] text-white hover:bg-white/15 hover:text-white"
              onClick={() => void startNewConversation()}
              disabled={busy}
              aria-label="Start new conversation"
              title="Start new conversation"
            >
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> New
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-white hover:bg-white/15 hover:text-white"
              onClick={() => setOpen(false)}
              aria-label="Minimize"
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {error ? (
          <div className="border-b px-3 py-2 text-xs" style={{ borderColor: `${BRAND}33`, backgroundColor: "#FEF2F2", color: "#B91C1C" }}>
            {error}
          </div>
        ) : null}

        {showContactForm ? (
          <div className="flex flex-1 flex-col overflow-y-auto px-3.5 py-4">
            <p className="text-sm font-semibold" style={{ color: BRAND }}>
              {profileReady ? "Edit your contact" : "Share your contact to start"}
            </p>
            <p className="mt-1 text-xs" style={{ color: `${BRAND}B3` }}>
              Name, email, phone, and location are required. Company is optional.
            </p>
            <div className="mt-3 grid gap-2">
              <div className="relative">
                <User className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" style={{ color: BRAND }} />
                <Input
                  value={profile.name}
                  onChange={(e) => setProfile((s) => ({ ...s, name: e.target.value }))}
                  placeholder="Name *"
                  className="h-9 border pl-8 text-xs"
                  style={{ borderColor: `${BRAND}44`, color: BRAND }}
                />
              </div>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" style={{ color: BRAND }} />
                <Input
                  value={profile.email}
                  onChange={(e) => setProfile((s) => ({ ...s, email: e.target.value }))}
                  placeholder="Email *"
                  className="h-9 border pl-8 text-xs"
                  style={{ borderColor: `${BRAND}44`, color: BRAND }}
                />
              </div>
              <div className="relative">
                <Phone className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" style={{ color: BRAND }} />
                <Input
                  value={profile.phone}
                  onChange={(e) => setProfile((s) => ({ ...s, phone: e.target.value }))}
                  placeholder="Phone *"
                  className="h-9 border pl-8 text-xs"
                  style={{ borderColor: `${BRAND}44`, color: BRAND }}
                />
              </div>
              <div className="relative">
                <MapPin className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" style={{ color: BRAND }} />
                <Input
                  value={profile.location}
                  onChange={(e) => setProfile((s) => ({ ...s, location: e.target.value }))}
                  placeholder="Location *"
                  className="h-9 border pl-8 text-xs"
                  style={{ borderColor: `${BRAND}44`, color: BRAND }}
                />
              </div>
              <div className="relative">
                <Building2 className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" style={{ color: BRAND }} />
                <Input
                  value={profile.company}
                  onChange={(e) => setProfile((s) => ({ ...s, company: e.target.value }))}
                  placeholder="Company (optional)"
                  className="h-9 border pl-8 text-xs"
                  style={{ borderColor: `${BRAND}44`, color: BRAND }}
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                className="flex-1 text-white hover:opacity-95"
                style={{ backgroundColor: BRAND }}
                disabled={busy}
                onClick={() => void saveContactAndContinue()}
              >
                {profileReady ? "Save" : "Continue to chat"}
              </Button>
              {profileReady ? (
                <Button
                  variant="outline"
                  className="border"
                  style={{ borderColor: BRAND, color: BRAND }}
                  disabled={busy}
                  onClick={() => {
                    setEditingContact(false);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto p-3.5" style={{ backgroundColor: "#F7F8FC" }}>
              {msgs.map((m) => (
                <div key={m.id} className={cn("flex gap-2", m.from === "user" ? "justify-end" : "justify-start")}>
                  {m.from === "bot" && (
                    <div className="mt-0.5 grid size-6 shrink-0 place-items-center overflow-hidden rounded-md bg-white">
                      <img src="/favicon-32.png" alt="" className="size-5 object-contain" />
                    </div>
                  )}
                  <div
                    className={cn("max-w-[80%] space-y-1 rounded-xl px-3 py-2 text-sm leading-relaxed")}
                    style={
                      m.from === "user"
                        ? { backgroundColor: BRAND, color: INK }
                        : m.kind === "agent"
                          ? { backgroundColor: "#E8ECF8", color: BRAND, border: `1px solid ${BRAND}33` }
                          : { backgroundColor: INK, color: BRAND, border: `1px solid ${BRAND}22` }
                    }
                  >
                    {m.kind === "agent" ? <p className="mb-1 text-[10px] font-medium opacity-70">Support team</p> : null}
                    {m.text}
                  </div>
                </div>
              ))}
              {typing && (
                <div className="flex items-center gap-2 text-xs" style={{ color: `${BRAND}99` }}>
                  typing...
                </div>
              )}
              <div ref={endRef} />
            </div>

            <form
              className="flex items-center gap-1.5 border-t p-2.5"
              style={{ borderColor: `${BRAND}22`, backgroundColor: INK }}
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your message…"
                className="h-9 border text-sm"
                style={{ borderColor: `${BRAND}33`, color: BRAND }}
                disabled={busy || !key}
              />
              <Button
                type="submit"
                size="icon"
                className="size-8 shrink-0 text-white hover:opacity-95"
                style={{ backgroundColor: BRAND }}
                disabled={busy || !draft.trim()}
              >
                <Send className="size-4" />
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
