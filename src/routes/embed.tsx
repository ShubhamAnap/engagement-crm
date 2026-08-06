import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, Mail, MapPin, Mic, Phone, RefreshCw, Send, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createSpeechRecognition,
  ensureMicrophonePermission,
  speechRecognitionSupported,
  type SpeechRecognitionLike,
} from "@/lib/speech-to-text";
import {
  widgetGetOrCreateConversation,
  widgetListMessages,
  widgetLookupVisitor,
  widgetSendMessage,
  widgetSelectProduct,
} from "@/server/widget-chat";
import { ChatDownloadLinks, ChatReferenceImages, cleanChatExtrasCaption } from "@/components/ChatReferenceImages";
import { ChatProductCarousel, extractProductCarousel, type ChatProductCard } from "@/components/ChatProductCarousel";
import { useStickToBottomScroll } from "@/lib/chat-scroll";

const SESSION_KEY = "enertech-embed-session";
const PROFILE_KEY = "enertech-embed-profile";
const BRAND = "#0B2388";
const INK = "#FFFFFF";

type ServerMessage = {
  id: string;
  sender: string;
  body: string;
  metadata?: Record<string, unknown> | null;
};
type RefImage = { url: string; title?: string; collection?: string; file_name?: string };
type DownloadLink = { url: string; title: string; fileName?: string };
type UiMsg = {
  id: string;
  from: "bot" | "user";
  text: string;
  kind?: "ai" | "agent";
  images?: RefImage[];
  downloads?: DownloadLink[];
  products?: ChatProductCard[];
};
type VisitorProfile = { name: string; email: string; phone: string; company: string; location: string };

const welcome: UiMsg = {
  id: "welcome",
  from: "bot",
  text: "Hi 👋 I'm EnerBot from EnerTech UPS. Ask about products, runtime, service, or request a quotation.",
};

const emptyProfile: VisitorProfile = { name: "", email: "", phone: "", company: "", location: "" };

export const Route = createFileRoute("/embed")({
  validateSearch: (search: Record<string, unknown>) => ({
    key: typeof search.key === "string" ? search.key : "",
    parentOrigin: typeof search.parentOrigin === "string" ? search.parentOrigin : "",
  }),
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

function extractReferenceImages(meta: Record<string, unknown> | null | undefined): RefImage[] {
  const raw = meta?.reference_images;
  if (!Array.isArray(raw)) return [];
  const out: RefImage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url : "";
    if (!url) continue;
    out.push({
      url,
      title: typeof row.title === "string" ? row.title : undefined,
      collection: typeof row.collection === "string" ? row.collection : undefined,
      file_name: typeof row.file_name === "string" ? row.file_name : undefined,
    });
  }
  return out;
}

function extractDownloadLinks(meta: Record<string, unknown> | null | undefined): DownloadLink[] {
  const raw = meta?.download_links;
  if (!Array.isArray(raw)) return [];
  const out: DownloadLink[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url : "";
    const title = typeof row.title === "string" ? row.title : "";
    if (!url || !title) continue;
    out.push({
      url,
      title,
      fileName: typeof row.file_name === "string" ? row.file_name : title,
    });
  }
  return out;
}

function toUi(messages: ServerMessage[]): UiMsg[] {
  return messages.map((m) => ({
    id: m.id,
    from: m.sender === "customer" ? "user" : "bot",
    text: m.body,
    kind: m.sender === "agent" ? "agent" : m.sender === "ai" ? "ai" : undefined,
    images: extractReferenceImages(m.metadata),
    downloads: extractDownloadLinks(m.metadata),
    products: extractProductCarousel(m.metadata),
  }));
}

function applyHistory(messages: ServerMessage[]): UiMsg[] {
  return messages.length ? [welcome, ...toUi(messages)] : [welcome];
}

function EmbedChat() {
  const { key, parentOrigin } = Route.useSearch();
  const pageOrigin =
    parentOrigin || (typeof window !== "undefined" ? window.location.origin : "");
  const embeddedInHost = Boolean(parentOrigin);
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
  const [listening, setListening] = useState(false);
  const [micHint, setMicHint] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef(profile);
  const lookedUpRef = useRef("");
  const busyRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const draftBeforeListenRef = useRef("");
  const micSupported = speechRecognitionSupported();

  const profileReady = isProfileComplete(profile);
  const showContactForm = editingContact || !profileReady;
  const { listRef, onScroll, pinToBottom } = useStickToBottomScroll([
    msgs,
    typing,
    open,
    showContactForm,
  ]);

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
    if (open && !showContactForm) pinToBottom();
  }, [open, showContactForm, pinToBottom]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    };
  }, []);

  function stopListening() {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    setListening(false);
  }

  async function toggleMic() {
    if (busy || !key) return;
    if (listening) {
      stopListening();
      setMicHint(null);
      return;
    }
    if (!micSupported) {
      setError("Voice input is not supported in this browser. Please type your message (Chrome works best).");
      return;
    }

    setError(null);
    setMicHint("When the browser asks, tap Allow so we can hear your message.");
    draftBeforeListenRef.current = draft.trim();

    try {
      await ensureMicrophonePermission();
    } catch {
      setListening(false);
      setMicHint(null);
      setError(
        "Microphone blocked. Click the lock/mic icon in the browser address bar and choose Allow, then try again.",
      );
      return;
    }

    const recognition = createSpeechRecognition({
      lang: "EN",
      onInterim: (text) => {
        const prefix = draftBeforeListenRef.current;
        setDraft(prefix ? `${prefix} ${text}` : text);
      },
      onFinal: (text) => {
        const prefix = draftBeforeListenRef.current;
        const next = prefix ? `${prefix} ${text}` : text;
        setDraft(next);
        draftBeforeListenRef.current = next;
      },
      onError: (message) => {
        setMicHint(null);
        setError(message);
      },
      onEnd: () => {
        recognitionRef.current = null;
        setListening(false);
        setMicHint(null);
      },
    });
    if (!recognition) {
      setMicHint(null);
      setError("Voice input is not available in this browser.");
      return;
    }

    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
      setMicHint("Listening… speak now, then edit the text and tap Send.");
    } catch {
      setListening(false);
      setMicHint(null);
      setError("Could not start the microphone. Check browser permissions.");
    }
  }

  async function syncConversationProfile(override?: VisitorProfile) {
    if (!key) return null;
    const visitor = override ?? profileRef.current;
    const prevId = conversationIdRef.current;
    const convo = await widgetGetOrCreateConversation({
      data: {
        key,
        sessionId: getSessionId(),
        pageOrigin,
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
        data: { key, pageOrigin, conversationId: nextId },
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
    pinToBottom();
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
      data: { key, pageOrigin, conversationId: convoId },
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
          data: { key, pageOrigin, conversationId },
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
            data: { key, pageOrigin, email: profile.email, phone: profile.phone },
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
    pinToBottom();
    setMsgs((m) => [...m, { id: `local-${Date.now()}`, from: "user", text: userText }]);

    try {
      persistProfile(profile);
      let convoId = conversationId;
      if (!convoId) convoId = await syncConversationProfile(profile);
      else await syncConversationProfile(profile);
      if (!convoId) throw new Error("Conversation not ready");
      const result = await widgetSendMessage({
        data: { key, pageOrigin, conversationId: convoId, body: userText },
      });
      setMsgs(applyHistory(result.messages as unknown as ServerMessage[]));
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

  async function needThisProduct(productId: string) {
    if (!productId || busy || !key) return;
    if (!isProfileComplete(profile)) {
      setEditingContact(true);
      setError("Please share your name, email, phone, and location so we can help you.");
      return;
    }
    setBusy(true);
    setTyping(true);
    pinToBottom();
    try {
      persistProfile(profile);
      let convoId = conversationId;
      if (!convoId) convoId = await syncConversationProfile(profile);
      else await syncConversationProfile(profile);
      if (!convoId) throw new Error("Conversation not ready");
      const result = await widgetSelectProduct({
        data: { key, pageOrigin, conversationId: convoId, productId },
      });
      setMsgs(applyHistory(result.messages as unknown as ServerMessage[]));
      if (result.aiPaused || result.status === "human" || result.status === "escalated") setHumanMode(true);
      setEditingContact(false);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Could not load product details");
    } finally {
      setTyping(false);
      setBusy(false);
    }
  }

  function notifyHost(type: "close" | "open") {
    if (typeof window === "undefined" || !parentOrigin) return;
    try {
      window.parent.postMessage({ source: "enertech-embed", type }, parentOrigin);
    } catch (err) {
      console.error("widget host notify failed", err);
    }
  }

  function closeWidget() {
    notifyHost("close");
    // Host hides the iframe; when opened standalone (/embed), collapse to launcher
    if (!embeddedInHost) setOpen(false);
  }

  useEffect(() => {
    if (!embeddedInHost) return;
    function onHostMessage(event: MessageEvent) {
      if (event.origin !== parentOrigin) return;
      const data = event.data as { source?: string; type?: string } | null;
      if (!data || data.source !== "enertech-widget") return;
      if (data.type === "open") setOpen(true);
      if (data.type === "close") setOpen(true); // stay ready; host hides iframe
    }
    window.addEventListener("message", onHostMessage);
    return () => window.removeEventListener("message", onHostMessage);
  }, [embeddedInHost, parentOrigin]);

  if (!open) {
    // Embedded: host owns the launcher — don't leave a black iframe shell
    if (embeddedInHost) {
      return <div className="min-h-screen bg-transparent" />;
    }
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
              onClick={closeWidget}
              aria-label="Close chat"
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
              {profileReady ? "Edit your contact" : "To assist you better, we need the following details."}
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
            <div
              ref={listRef}
              onScroll={onScroll}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3.5"
              style={{ backgroundColor: "#F7F8FC", WebkitOverflowScrolling: "touch" }}
            >
              {msgs.map((m) => (
                <div key={m.id} className={cn("flex gap-2", m.from === "user" ? "justify-end" : "justify-start")}>
                  {m.from === "bot" && (
                    <div className="mt-0.5 grid size-6 shrink-0 place-items-center overflow-hidden rounded-md bg-white">
                      <img src="/favicon-32.png" alt="" className="size-5 object-contain" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[82%] min-w-0 overflow-hidden rounded-xl text-sm leading-relaxed",
                      m.from === "user" ? "" : "",
                    )}
                    style={
                      m.from === "user"
                        ? { backgroundColor: BRAND, color: INK }
                        : m.kind === "agent"
                          ? { backgroundColor: "#E8ECF8", color: BRAND, border: `1px solid ${BRAND}33` }
                          : { backgroundColor: INK, color: BRAND, border: `1px solid ${BRAND}22` }
                    }
                  >
                    {m.kind === "agent" ? (
                      <p className="mb-0 px-3 pt-2 text-[10px] font-medium opacity-70">Support team</p>
                    ) : null}
                    {(() => {
                      const caption = cleanChatExtrasCaption(m.text, {
                        hasImages: Boolean(m.images?.length),
                        hasDownloads: Boolean(m.downloads?.length),
                      });
                      return caption ? (
                        <p className="whitespace-pre-wrap break-words px-3 py-2">{caption}</p>
                      ) : null;
                    })()}
                    {m.products && m.products.length > 0 ? (
                      <div className="px-2 pb-2">
                        <ChatProductCarousel
                          products={m.products}
                          brand={BRAND}
                          disabled={busy}
                          onNeedThis={(id) => void needThisProduct(id)}
                        />
                      </div>
                    ) : null}
                    {m.downloads && m.downloads.length > 0 ? (
                      <div className="px-2 pb-2">
                        <ChatDownloadLinks links={m.downloads} brand={BRAND} />
                      </div>
                    ) : null}
                    {m.images && m.images.length > 0 ? (
                      <div className="px-2 pb-2">
                        <ChatReferenceImages images={m.images} brand={BRAND} />
                      </div>
                    ) : null}
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

            {micHint ? (
              <div className="border-t px-3 py-1.5 text-[11px]" style={{ borderColor: `${BRAND}22`, backgroundColor: "#EEF1FA", color: BRAND }}>
                {micHint}
              </div>
            ) : null}
            <form
              className="flex items-center gap-1.5 border-t p-2.5"
              style={{ borderColor: `${BRAND}22`, backgroundColor: INK }}
              onSubmit={(e) => {
                e.preventDefault();
                if (listening) stopListening();
                void send(draft);
              }}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                style={{ color: listening ? "#DC2626" : BRAND }}
                aria-label={listening ? "Stop listening" : "Speak message"}
                title={listening ? "Stop listening" : "Speak — text appears for you to edit, then send"}
                disabled={busy || !key}
                onClick={() => toggleMic()}
              >
                <Mic className={cn("size-4", listening && "animate-pulse")} />
              </Button>
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={listening ? "Listening… speak now" : "Type your message…"}
                className="h-9 border text-sm"
                style={{ borderColor: `${BRAND}33`, color: BRAND }}
                disabled={busy || !key}
              />
              <Button
                type="submit"
                size="icon"
                className="size-8 shrink-0 text-white hover:opacity-95"
                style={{ backgroundColor: BRAND }}
                disabled={busy || !draft.trim() || listening}
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
