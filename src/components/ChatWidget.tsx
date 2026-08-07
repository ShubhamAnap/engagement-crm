import { useEffect, useRef, useState } from "react";
import { Building2, Headphones, Languages, Mail, MapPin, Mic, Paperclip, Phone, RefreshCw, Send, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
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
  widgetUploadAttachment,
} from "@/server/widget-chat";
import { ChatDownloadLinks, ChatReferenceImages, cleanChatExtrasCaption } from "@/components/ChatReferenceImages";
import { ChatProductCarousel, extractProductCarousel, type ChatProductCard } from "@/components/ChatProductCarousel";
import { useStickToBottomScroll } from "@/lib/chat-scroll";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRY_OPTIONS,
  composeInternationalPhone,
  formatPhoneCountryOption,
  splitInternationalPhone,
} from "@/lib/phone-country";

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
type VisitorProfile = {
  name: string;
  email: string;
  /** National number only (no country dial). */
  phone: string;
  phoneCountryCode: string;
  company: string;
  location: string;
};

const SESSION_KEY = "enertech-widget-session";
const PROFILE_KEY = "enertech-widget-profile";
const BRAND = "#0B2388";
const INK = "#FFFFFF";
const suggested = ["Which UPS suits a 3 kVA load?", "Battery runtime calculator", "Please call me", "I need a quotation"];
const welcome: UiMsg = {
  id: "welcome",
  from: "bot",
  text: "Hi 👋 I'm EnerBot from EnerTech UPS. Ask about products, runtime, service, or request a quotation.",
};
const emptyProfile: VisitorProfile = {
  name: "",
  email: "",
  phone: "",
  phoneCountryCode: DEFAULT_PHONE_COUNTRY,
  company: "",
  location: "",
};

function profilePhoneE164(profile: VisitorProfile) {
  return composeInternationalPhone(profile.phoneCountryCode || DEFAULT_PHONE_COUNTRY, profile.phone);
}

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
    const parsed = JSON.parse(raw) as Partial<VisitorProfile> & { phoneCountryCode?: string };
    const storedCode = String(parsed.phoneCountryCode || "").replace(/\D/g, "");
    const storedPhone = String(parsed.phone || "");
    // Older profiles stored full E.164 in `phone` without a dial selector
    if (!storedCode && storedPhone.replace(/\D/g, "").length > 10) {
      const split = splitInternationalPhone(storedPhone);
      return {
        name: String(parsed.name || ""),
        email: String(parsed.email || ""),
        phone: split.national,
        phoneCountryCode: split.countryCode,
        company: String(parsed.company || ""),
        location: String(parsed.location || ""),
      };
    }
    return {
      name: String(parsed.name || ""),
      email: String(parsed.email || ""),
      phone: storedPhone,
      phoneCountryCode: storedCode || DEFAULT_PHONE_COUNTRY,
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
      profilePhoneE164(profile).length >= 10 &&
      profile.location.trim(),
  );
}

function hasIdentity(profile: VisitorProfile) {
  return Boolean(profile.email.trim() || profilePhoneE164(profile));
}

function mergeMissingFields(current: VisitorProfile, known: Partial<VisitorProfile> & { phone?: string }): VisitorProfile {
  const knownSplit = known.phone?.trim() ? splitInternationalPhone(known.phone) : null;
  return {
    name: current.name.trim() || known.name?.trim() || "",
    email: current.email.trim() || known.email?.trim() || "",
    phone: current.phone.trim() || knownSplit?.national || "",
    phoneCountryCode:
      current.phoneCountryCode ||
      known.phoneCountryCode ||
      knownSplit?.countryCode ||
      DEFAULT_PHONE_COUNTRY,
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
  return messages
    .filter((m) => m.sender !== "system")
    .map((m) => ({
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
  const [editingContact, setEditingContact] = useState(true);
  const [listening, setListening] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef(profile);
  const lookedUpRef = useRef("");
  const busyRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const draftBeforeListenRef = useRef("");
  const widgetKey = (import.meta.env.VITE_WIDGET_PUBLIC_KEY as string) || "";
  const pageOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const profileReady = isProfileComplete(profile);
  const showContactForm = editingContact || !profileReady;
  const micSupported = speechRecognitionSupported();
  const { listRef, onScroll, pinToBottom } = useStickToBottomScroll([msgs, typing, open]);

  useEffect(() => {
    const initial = loadStoredProfile();
    setProfile(initial);
    profileRef.current = initial;
    setEditingContact(!isProfileComplete(initial));
  }, []);

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
    if (busy) return;
    if (listening) {
      stopListening();
      return;
    }
    if (!micSupported) {
      toast.error("Voice input is not supported in this browser. Chrome works best.");
      return;
    }

    toast.message("When the browser asks, tap Allow so we can hear your message.");
    draftBeforeListenRef.current = draft.trim();

    try {
      await ensureMicrophonePermission();
    } catch {
      toast.error(
        "Microphone blocked. Click the lock/mic icon in the browser address bar and choose Allow, then try again.",
      );
      return;
    }

    const recognition = createSpeechRecognition({
      lang,
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
      onError: (message) => toast.error(message),
      onEnd: () => {
        recognitionRef.current = null;
        setListening(false);
      },
    });
    if (!recognition) {
      toast.error("Voice input is not available in this browser.");
      return;
    }

    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
      toast.error("Could not start the microphone. Check browser permissions.");
    }
  }

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
    if (open) pinToBottom();
  }, [open, pinToBottom]);

  async function syncConversationProfile(override?: VisitorProfile) {
    if (!widgetKey) throw new Error("Widget public key is missing. Check .env and restart the dev server.");
    const visitor = override ?? profileRef.current;
    const prevId = conversationIdRef.current;
    const convo = await widgetGetOrCreateConversation({
      data: {
        key: widgetKey,
        sessionId: getSessionId(),
        pageOrigin,
        visitorName: visitor.name,
        visitorEmail: visitor.email,
        visitorPhone: profilePhoneE164(visitor),
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
        data: { key: widgetKey, pageOrigin, conversationId: nextId },
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
    // Only create Inbox conversation after contact form is complete
    if (isProfileComplete(keep)) {
      await syncConversationProfile(keep);
    }
  }

  async function resumeOrStartConversation() {
    const initial = loadStoredProfile();
    lookedUpRef.current = "";
    setProfile(initial);
    profileRef.current = initial;
    setEditingContact(!isProfileComplete(initial));
    // Opening the widget alone must not create an empty "Website visitor" Inbox thread
    if (!isProfileComplete(initial)) {
      setConversationId(null);
      conversationIdRef.current = null;
      setMsgs([welcome]);
      setHumanMode(false);
      return;
    }
    const convoId = await syncConversationProfile(initial);
    const history = (await widgetListMessages({
      data: { key: widgetKey, pageOrigin, conversationId: convoId },
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
    if (!open || !conversationId || !widgetKey || showContactForm) return;

    const poll = async () => {
      if (busyRef.current) return;
      try {
        const history = (await widgetListMessages({
          data: { key: widgetKey, pageOrigin, conversationId },
        })) as ServerMessage[];
        setMsgs(applyHistory(history));
        if (history.some((m) => m.sender === "agent")) setHumanMode(true);
      } catch (err) {
        console.error(err);
      }
    };

    const timer = window.setInterval(() => void poll(), 2500);
    return () => window.clearInterval(timer);
  }, [open, conversationId, widgetKey, showContactForm]);

  useEffect(() => {
    if (!open || !session || !widgetKey) return;
    if (!hasIdentity(profile)) return;

    const e164 = profilePhoneE164(profile);
    const lookupKey = `${profile.email.trim().toLowerCase()}|${e164}`;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (lookedUpRef.current === lookupKey) return;
          const known = await widgetLookupVisitor({
            data: { key: widgetKey, pageOrigin, email: profile.email, phone: e164 },
          });
          lookedUpRef.current = lookupKey;
          if (!known) return;

          const merged = mergeMissingFields(profileRef.current, known);
          setProfile(merged);
          profileRef.current = merged;
          persistProfile(merged);
          toast.message("Welcome back — we filled known details.");
        } catch (err) {
          console.error(err);
        }
      })();
    }, 500);

    return () => window.clearTimeout(timer);
  }, [profile.email, profile.phone, profile.phoneCountryCode, open, session, widgetKey]);

  async function saveContactAndContinue() {
    if (!isProfileComplete(profile)) {
      toast.error("Please fill Name, Email, Phone, and Location to continue.");
      return;
    }
    setBusy(true);
    try {
      persistProfile(profile);
      profileRef.current = profile;
      await syncConversationProfile(profile);
      setEditingContact(false);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Could not save details");
    } finally {
      setBusy(false);
    }
  }

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
      setEditingContact(true);
      toast.error("Please fill Name, Email, Phone, and Location before uploading");
      return;
    }

    setBusy(true);
    setTyping(true);
    pinToBottom();
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
          pageOrigin,
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
      setEditingContact(true);
      toast.error("Please share your name, email, phone, and location so we can help you.");
      return;
    }

    setBusy(true);
    const userText = text.trim();
    setDraft("");
    pinToBottom();
    setMsgs((m) => [...m, { id: `local-${Date.now()}`, from: "user", text: userText }]);
    setTyping(true);

    try {
      persistProfile(profile);
      let convoId = conversationId;
      if (!convoId) convoId = await syncConversationProfile(profile);
      else await syncConversationProfile(profile);
      const result = await widgetSendMessage({
        data: { key: widgetKey, pageOrigin, conversationId: convoId, body: userText },
      });
      setMsgs(applyHistory(result.messages as ServerMessage[]));
      if (result.aiPaused || result.status === "human" || result.status === "escalated") setHumanMode(true);
      setEditingContact(false);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setTyping(false);
      setBusy(false);
    }
  };

  const needThisProduct = async (productId: string) => {
    if (busy || !productId) return;
    if (!session) {
      toast.error("Sign in to use the live widget preview");
      return;
    }
    if (!widgetKey) {
      toast.error("Widget public key is missing.");
      return;
    }
    if (!isProfileComplete(profile)) {
      setEditingContact(true);
      toast.error("Please share your name, email, phone, and location so we can help you.");
      return;
    }

    setBusy(true);
    pinToBottom();
    setTyping(true);
    try {
      persistProfile(profile);
      let convoId = conversationId;
      if (!convoId) convoId = await syncConversationProfile(profile);
      else await syncConversationProfile(profile);
      const result = await widgetSelectProduct({
        data: { key: widgetKey, pageOrigin, conversationId: convoId, productId },
      });
      setMsgs(applyHistory(result.messages as ServerMessage[]));
      if (result.aiPaused || result.status === "human" || result.status === "escalated") setHumanMode(true);
      setEditingContact(false);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Could not load product details");
    } finally {
      setTyping(false);
      setBusy(false);
    }
  };

  return (
    <>
      {open && (
        <div
          className="fixed right-2 bottom-[4.75rem] z-50 flex h-[min(640px,calc(100dvh-6.5rem))] w-[min(384px,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border shadow-2xl sm:right-4 sm:bottom-20"
          style={{ borderColor: BRAND, backgroundColor: INK, color: BRAND }}
        >
          <header className="flex items-center gap-2.5 px-3.5 py-3 text-white" style={{ backgroundColor: BRAND }}>
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
              >
                <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> New
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-1.5 text-[11px] text-white hover:bg-white/15 hover:text-white"
                onClick={() => setLang((l) => (l === "EN" ? "HI" : l === "HI" ? "TA" : "EN"))}
                aria-label="Switch language"
              >
                <Languages className="size-3.5" /> {lang}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-white hover:bg-white/15 hover:text-white"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
              >
                <X className="size-4" />
              </Button>
            </div>
          </header>

          {showContactForm ? (
            <div className="flex flex-1 flex-col overflow-y-auto px-3.5 py-4">
              <p className="text-sm font-semibold" style={{ color: BRAND }}>
                {profileReady ? "Edit your contact" : "To assist you better, we need the following details."}
              </p>
              <div className="mt-3 grid gap-2">
                <div className="relative">
                  <User className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" style={{ color: BRAND }} />
                  <Input value={profile.name} onChange={(e) => setProfile((s) => ({ ...s, name: e.target.value }))} placeholder="Name *" className="h-9 border pl-8 text-xs" style={{ borderColor: `${BRAND}44`, color: BRAND }} />
                </div>
                <div className="relative">
                  <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" style={{ color: BRAND }} />
                  <Input value={profile.email} onChange={(e) => setProfile((s) => ({ ...s, email: e.target.value }))} placeholder="Email *" className="h-9 border pl-8 text-xs" style={{ borderColor: `${BRAND}44`, color: BRAND }} />
                </div>
                <div className="flex gap-1.5">
                  <select
                    aria-label="Country code"
                    value={profile.phoneCountryCode || DEFAULT_PHONE_COUNTRY}
                    onChange={(e) => setProfile((s) => ({ ...s, phoneCountryCode: e.target.value }))}
                    className="h-9 w-[4.75rem] shrink-0 rounded-md border bg-white px-1 text-center text-[11px] font-semibold outline-none"
                    style={{ borderColor: `${BRAND}44`, color: BRAND }}
                  >
                    {PHONE_COUNTRY_OPTIONS.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {formatPhoneCountryOption(opt.code, opt.label)}
                      </option>
                    ))}
                  </select>
                  <div className="relative min-w-0 flex-1">
                    <Phone className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" style={{ color: BRAND }} />
                    <Input
                      value={profile.phone}
                      onChange={(e) => setProfile((s) => ({ ...s, phone: e.target.value.replace(/[^\d\s-]/g, "") }))}
                      placeholder="Mobile number *"
                      inputMode="tel"
                      autoComplete="tel-national"
                      className="h-9 border pl-8 text-xs"
                      style={{ borderColor: `${BRAND}44`, color: BRAND }}
                    />
                  </div>
                </div>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" style={{ color: BRAND }} />
                  <Input value={profile.location} onChange={(e) => setProfile((s) => ({ ...s, location: e.target.value }))} placeholder="Location *" className="h-9 border pl-8 text-xs" style={{ borderColor: `${BRAND}44`, color: BRAND }} />
                </div>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" style={{ color: BRAND }} />
                  <Input value={profile.company} onChange={(e) => setProfile((s) => ({ ...s, company: e.target.value }))} placeholder="Company (optional)" className="h-9 border pl-8 text-xs" style={{ borderColor: `${BRAND}44`, color: BRAND }} />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button className="flex-1 text-white hover:opacity-95" style={{ backgroundColor: BRAND }} disabled={busy} onClick={() => void saveContactAndContinue()}>
                  {profileReady ? "Save" : "Continue to chat"}
                </Button>
                {profileReady ? (
                  <Button variant="outline" className="border" style={{ borderColor: BRAND, color: BRAND }} disabled={busy} onClick={() => setEditingContact(false)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              {humanMode ? (
                <div className="border-b px-3.5 py-2 text-xs" style={{ borderColor: `${BRAND}22`, backgroundColor: "#FFFBEB", color: BRAND }}>
                  You’re chatting with our support team — keep messaging here.
                </div>
              ) : null}

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
                    <div className={cn("max-w-[80%] space-y-1", m.from === "user" && "items-end")}>
                      {m.kind === "agent" ? <p className="px-1 text-[10px] font-medium" style={{ color: `${BRAND}99` }}>Support team</p> : null}
                      <div
                        className="min-w-0 overflow-hidden rounded-xl text-sm leading-relaxed"
                        style={
                          m.from === "user"
                            ? { backgroundColor: BRAND, color: INK }
                            : m.kind === "agent"
                              ? { backgroundColor: "#E8ECF8", color: BRAND, border: `1px solid ${BRAND}33` }
                              : { backgroundColor: INK, color: BRAND, border: `1px solid ${BRAND}22` }
                        }
                      >
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
                  </div>
                ))}
                {typing && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: `${BRAND}99` }}>
                    typing...
                  </div>
                )}
                <div ref={endRef} />
              </div>

              <div className="flex flex-wrap gap-1.5 border-t px-3.5 py-2" style={{ borderColor: `${BRAND}22`, backgroundColor: INK }}>
                {suggested.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border px-2.5 py-1 text-[11px] transition-opacity hover:opacity-80"
                    style={{ borderColor: `${BRAND}44`, color: BRAND }}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <form
                className="flex items-center gap-1.5 border-t p-2.5"
                style={{ borderColor: `${BRAND}22`, backgroundColor: INK }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (listening) stopListening();
                  void send(draft);
                }}
              >
                <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" style={{ color: BRAND }} aria-label="Attach file" disabled={busy || listening} onClick={() => fileRef.current?.click()}>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  style={{ color: listening ? "#DC2626" : BRAND }}
                  aria-label={listening ? "Stop listening" : "Speak message"}
                  title={listening ? "Stop listening" : "Speak — text appears for you to edit, then send"}
                  disabled={busy}
                  onClick={() => toggleMic()}
                >
                  <Mic className={cn("size-4", listening && "animate-pulse")} />
                </Button>
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={listening ? "Listening… speak now" : "Ask about products, service or pricing…"}
                  className="h-9 border text-sm"
                  style={{ borderColor: `${BRAND}33`, color: BRAND }}
                  aria-label="Message"
                  disabled={busy}
                />
                <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" style={{ color: BRAND }} aria-label="Request callback" disabled={busy || listening} onClick={() => void send("Please call me")}>
                  <Headphones className="size-4" />
                </Button>
                <Button type="submit" size="icon" className="size-8 shrink-0 text-white hover:opacity-95" style={{ backgroundColor: BRAND }} aria-label="Send" disabled={busy || listening || !draft.trim()}>
                  <Send className="size-4" />
                </Button>
              </form>
            </>
          )}
        </div>
      )}

      <Button
        onClick={() => setOpen((v) => !v)}
        className="fixed right-2 bottom-3 z-50 h-[72px] w-[72px] flex-col gap-0.5 rounded-full border-2 border-white px-2 text-white shadow-lg sm:right-4 sm:bottom-4"
        style={{ backgroundColor: BRAND }}
        aria-label={open ? "Close chat" : "ASK EnerTech"}
      >
        {open ? (
          <span className="text-xs font-bold">Close</span>
        ) : (
          <>
            <span className="text-[13px] font-extrabold tracking-wide leading-none">ASK</span>
            <span className="text-[9px] font-semibold leading-none opacity-95">EnerTech</span>
          </>
        )}
      </Button>
    </>
  );
}
