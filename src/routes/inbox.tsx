import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  PageHeader,
  Panel as CardPanel,
  Pill,
  Toolbar,
  ChannelIcon,
  ScoreBar,
  EmptyState,
  ListSkeleton,
} from "@/components/shared/ui-kit";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  LayoutGrid,
  Package,
  Paperclip,
  RefreshCw,
  Send,
  ArrowLeft,
  User,
  Bot,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  ENERTECH_ORG_ID,
  formatClock,
  formatRelativeTime,
  getConversationById,
  listConversations,
  listMessages,
  markConversationRead,
  patchMessageMetadata,
  returnConversationToAi,
  sendAgentMessage,
  uploadAgentAttachment,
  type InboxConversation,
} from "@/lib/chat-api";
import { getBrowserSupabase } from "@/lib/supabase";
import {
  listWaTemplates,
  sendInboxWhatsAppTemplate,
  type DbWaTemplate,
} from "@/lib/broadcasting-api";
import { listProducts } from "@/lib/products-api";
import type { ChannelType, DbMessage, DbProduct, LeadStatus, PriorityLevel } from "@/lib/db-types";
import { updateLeadStage } from "@/lib/leads-api";
import { cn } from "@/lib/utils";
import {
  conversationRepliesViaWhatsApp,
  getWhatsAppWindow,
  isMarketplaceLeadChannel,
  normalizeWhatsAppDigits,
  resolveWhatsAppWindowStart,
  whatsappMeUrl,
  type WhatsAppWindowState,
} from "@/lib/whatsapp-window";
import { formatDisplayPhone } from "@/lib/phone-country";
import { useStickToBottomScroll } from "@/lib/chat-scroll";
import { RecommendProductDialog } from "@/components/inbox/RecommendProductDialog";
import { SendWhatsAppTemplateDialog } from "@/components/inbox/SendWhatsAppTemplateDialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const filters = [
  "All",
  "Unread",
  "Assigned",
  "Website",
  "WhatsApp",
  "IndiaMART",
  "TradeIndia",
  "Brainmine",
  "Instagram",
  "Facebook",
  "Email",
];

/** Map Inbox chip label → DB channel (null = no channel eq). */
function inboxChannelParam(filter: string): string | null {
  switch (filter) {
    case "Website":
      return "website";
    case "WhatsApp":
      return "whatsapp";
    case "IndiaMART":
      return "indiamart";
    case "TradeIndia":
      return "tradeindia";
    case "Brainmine":
      return "brainmine";
    case "Instagram":
      return "instagram";
    case "Facebook":
      return "facebook";
    case "Email":
      return "email";
    default:
      return null;
  }
}

function inboxEmptyDescription(filter: string): string {
  switch (filter) {
    case "Unread":
      return "No unread conversations right now.";
    case "Assigned":
      return "No human-assigned conversations yet. Claim or reply from Inbox to assign yourself.";
    case "Website":
      return "No submitted website contacts yet. When a visitor saves name and phone in the chatbot, they appear here.";
    case "WhatsApp":
      return "No WhatsApp threads yet. Inbound Meta messages will show here.";
    case "IndiaMART":
      return "No IndiaMART conversations yet. Synced enquiries with WhatsApp contact appear here.";
    case "TradeIndia":
      return "No TradeIndia conversations yet.";
    case "Brainmine":
      return "No Brainmine-linked conversations yet. Leads sync on Channels; chat threads appear when messaging starts.";
    case "Instagram":
      return "No Instagram conversations yet.";
    case "Facebook":
      return "No Facebook conversations yet.";
    case "Email":
      return "No email conversations yet.";
    default:
      return "When customers message any connected channel, threads appear here — newest reply on top.";
  }
}

function cleanInboxPreview(preview: string | null | undefined): string {
  const raw = String(preview || "").trim();
  if (!raw) return "No messages yet";
  let text = raw.replace(/^\[Template:\s*[^\]]+\]\s*/i, "").trim() || raw;
  if (/^📷|^📄|^🎤|^🎬/u.test(text) || /^\[(image|document|audio|video|sticker)\]/i.test(text)) {
    const first = text.split("\n")[0]?.trim() || text;
    if (/^\[image\]/i.test(first)) return "📷 Photo";
    if (/^\[document\]/i.test(first)) return "📄 Document";
    if (/^\[audio\]/i.test(first)) return "🎤 Voice note";
    if (/^\[video\]/i.test(first)) return "🎬 Video";
    if (/^\[sticker\]/i.test(first)) return "Sticker";
    return first.slice(0, 80);
  }
  return text;
}

function dayDividerLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday.getTime() - startMsg.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function sameCalendarDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

type MessageAttach = {
  url: string;
  fileName: string;
  isImage: boolean;
  isAudio: boolean;
  isVideo: boolean;
  isDocument: boolean;
  mimeType: string;
};

function messageAttachment(m: DbMessage): MessageAttach | null {
  const meta = (m.metadata || {}) as Record<string, unknown>;
  const url = typeof meta.url === "string" ? meta.url : null;
  const mimeType = String(meta.mime_type || "").toLowerCase();
  const mediaType = String(meta.media_type || "").toLowerCase();
  const fileName =
    (typeof meta.file_name === "string" && meta.file_name) ||
    (url ? decodeURIComponent(url.split("/").pop() || "file") : "file");
  if (url) {
    const isImage =
      mimeType.startsWith("image/") ||
      mediaType === "image" ||
      mediaType === "sticker" ||
      /\.(png|jpe?g|webp|gif)(\?|$)/i.test(fileName) ||
      /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
    const isAudio =
      mimeType.startsWith("audio/") ||
      mediaType === "audio" ||
      /\.(ogg|mp3|m4a|wav|opus)(\?|$)/i.test(fileName);
    const isVideo =
      mimeType.startsWith("video/") ||
      mediaType === "video" ||
      /\.(mp4|3gp|mov|webm)(\?|$)/i.test(fileName);
    const isDocument = !isImage && !isAudio && !isVideo;
    return { url, fileName, isImage, isAudio, isVideo, isDocument, mimeType };
  }
  if (meta.attachment) {
    const match = m.body.match(/https?:\/\/\S+/);
    if (match) {
      return {
        url: match[0],
        fileName,
        isImage: /\.(png|jpe?g|webp|gif)(\?|$)/i.test(match[0]),
        isAudio: false,
        isVideo: false,
        isDocument: true,
        mimeType,
      };
    }
  }
  return null;
}

function messageWaStatus(m: DbMessage): string | null {
  const status = (m.metadata as { wa_status?: unknown } | null)?.wa_status;
  return typeof status === "string" ? status.toLowerCase() : null;
}

const leadStatuses: LeadStatus[] = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"];
const leadPriorities: PriorityLevel[] = ["High", "Medium", "Low"];
const LAYOUT_KEY = "enertech-inbox-layout-v1";

function waTone(tone: WhatsAppWindowState["tone"]): "success" | "warning" | "danger" | "neutral" | "primary" {
  if (tone === "ok") return "success";
  if (tone === "warn") return "warning";
  if (tone === "critical" || tone === "closed") return "danger";
  return "neutral";
}

function messageReferenceImages(
  m: DbMessage,
): Array<{ url: string; title: string; collection?: string }> {
  const raw = (m.metadata as { reference_images?: unknown } | null)?.reference_images;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ url: string; title: string; collection?: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url : "";
    if (!url) continue;
    out.push({
      url,
      title: typeof row.title === "string" ? row.title : "Reference photo",
      collection: typeof row.collection === "string" ? row.collection : undefined,
    });
  }
  return out;
}

export const Route = createFileRoute("/inbox")({
  validateSearch: (search: Record<string, unknown>): { c?: string } => ({
    c: typeof search.c === "string" && search.c.length > 0 ? search.c : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Omnichannel Inbox — EnerTech Engage" },
      {
        name: "description",
        content:
          "Every website, WhatsApp, email, IndiaMART, TradeIndia, Instagram and Facebook conversation in one shared workspace.",
      },
      { property: "og:title", content: "Omnichannel Inbox — EnerTech Engage" },
    ],
  }),
  component: Page,
});

function loadLayout(): Record<string, number> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : undefined;
  } catch {
    return undefined;
  }
}

function Page() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { c: deepLinkId } = Route.useSearch();
  const orgId = profile?.org.id ?? ENERTECH_ORG_ID;
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkId ?? null);
  const [channelFilter, setChannelFilter] = useState<string>("All");
  const [listSearch, setListSearch] = useState("");
  /** Mobile: list-first; open thread full-screen after tap (or deep link). */
  const [mobileThreadOpen, setMobileThreadOpen] = useState(() => Boolean(deepLinkId));
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [draftByConversation, setDraftByConversation] = useState<Record<string, string>>({});
  const draft = selectedId ? draftByConversation[selectedId] || "" : "";
  function setDraft(value: string) {
    if (!selectedId) return;
    setDraftByConversation((prev) => ({ ...prev, [selectedId]: value }));
  }
  function clearDraft(conversationId: string) {
    setDraftByConversation((prev) => {
      if (!(conversationId in prev)) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [sendingProduct, setSendingProduct] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [returningToAi, setReturningToAi] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [leadStatus, setLeadStatus] = useState<LeadStatus>("New");
  const [leadPriority, setLeadPriority] = useState<PriorityLevel>("Medium");
  const [layout, setLayout] = useState<Record<string, number> | undefined>(undefined);
  const [nowTick, setNowTick] = useState(() => Date.now());
  /** Only one thread instance may mount — shared scroll ref breaks if desktop+mobile both render. */
  const [isLg, setIsLg] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : true,
  );

  useEffect(() => {
    setLayout(loadLayout() ?? { list: 24, chat: 48, profile: 28 });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsLg(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const conversationsQuery = useQuery({
    queryKey: ["conversations", orgId, channelFilter],
    queryFn: () =>
      listConversations(orgId, {
        channel: inboxChannelParam(channelFilter),
        unreadOnly: channelFilter === "Unread",
        assignedOnly: channelFilter === "Assigned",
        limit: channelFilter === "All" ? 250 : 200,
      }),
    refetchInterval: 5000,
  });

  const conversations = useMemo(() => {
    const rows = conversationsQuery.data ?? [];
    const q = listSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => {
      const hay = [
        c.customer?.name,
        c.visitor_name,
        c.visitor_email,
        c.visitor_phone,
        c.preview,
        c.assignee_label,
        c.lead?.name,
        c.lead?.company,
        c.channel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [conversationsQuery.data, listSearch]);

  useEffect(() => {
    if (deepLinkId) {
      setSelectedId(deepLinkId);
      setMobileThreadOpen(true);
    }
  }, [deepLinkId]);

  // Live Inbox: Realtime for messages + conversation list (poll remains as fallback).
  useEffect(() => {
    if (!orgId) return;
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel(`inbox-conversations-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `org_id=eq.${orgId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);

  useEffect(() => {
    if (!selectedId) return;
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel(`inbox-messages-${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["messages", selectedId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedId, queryClient]);

  const deepLinkQuery = useQuery({
    queryKey: ["conversation", orgId, selectedId],
    enabled: Boolean(selectedId) && !(conversationsQuery.data ?? []).some((c) => c.id === selectedId),
    queryFn: () => getConversationById(selectedId!, orgId),
    staleTime: 30_000,
  });

  // Desktop only: auto-select first conversation so the middle pane isn't empty.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const pick = () => {
      if (mq.matches && !selectedId && conversations.length > 0) {
        setSelectedId(conversations[0].id);
      }
    };
    pick();
    mq.addEventListener("change", pick);
    return () => mq.removeEventListener("change", pick);
  }, [conversations, selectedId]);

  function openConversation(id: string) {
    setSelectedId(id);
    setMobileThreadOpen(true);
    void navigate({ to: "/inbox", search: { c: id }, replace: true });
  }

  function backToMobileList() {
    setMobileThreadOpen(false);
    setProfileSheetOpen(false);
    void navigate({ to: "/inbox", search: {}, replace: true });
  }

  const selected: InboxConversation | null =
    conversations.find((c) => c.id === selectedId) ??
    (deepLinkQuery.data && deepLinkQuery.data.id === selectedId ? deepLinkQuery.data : null);

  useEffect(() => {
    setLeadStatus(selected?.lead?.status ?? "New");
    setLeadPriority(selected?.lead?.priority ?? "Medium");
  }, [selected?.lead?.id, selected?.lead?.status, selected?.lead?.priority]);

  const messagesQuery = useQuery({
    queryKey: ["messages", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => listMessages(selectedId!),
    refetchInterval: 4000,
  });

  const {
    listRef: messagesScrollRef,
    endRef: messagesEndRef,
    onScroll: onMessagesScroll,
    pinToBottom,
  } = useStickToBottomScroll(
    [messagesQuery.data, messagesQuery.isLoading, isLg, layout],
    selectedId ?? null,
  );

  // Pin again when messages finish loading after a thread switch (flex layout may not be ready yet).
  const prevMessagesLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevMessagesLoadingRef.current;
    prevMessagesLoadingRef.current = messagesQuery.isLoading;
    if (selectedId && wasLoading && !messagesQuery.isLoading) {
      pinToBottom();
    }
  }, [selectedId, messagesQuery.isLoading, pinToBottom]);

  const lastCustomerMessageAt = useMemo(() => {
    const msgs = messagesQuery.data ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].sender === "customer") return msgs[i].created_at;
    }
    return null;
  }, [messagesQuery.data]);

  /** Show Return to AI while human or escalated owns the thread. */
  const showReturnToAi = useMemo(() => {
    if (!selected) return false;
    return selected.status === "human" || selected.status === "escalated";
  }, [selected]);

  const waOutbound = Boolean(selected && conversationRepliesViaWhatsApp(selected));
  const waPhone = selected
    ? normalizeWhatsAppDigits(selected.visitor_phone || selected.customer?.phone)
    : null;
  const marketplaceLead = Boolean(selected && isMarketplaceLeadChannel(selected.channel));

  const waWindow = useMemo(() => {
    if (!selected || !conversationRepliesViaWhatsApp(selected)) return null;
    // Marketplace enquiry messages are not WhatsApp inbounds — only wa_last_customer_at counts.
    const started = selected.channel === "whatsapp"
      ? resolveWhatsAppWindowStart({
          waLastCustomerAt: selected.wa_last_customer_at,
          lastCustomerMessageAt,
        })
      : selected.wa_last_customer_at || null;
    return getWhatsAppWindow(started, nowTick);
  }, [selected, lastCustomerMessageAt, nowTick]);

  /** Cloud API free-form when Meta window is open; marketplace first-contact uses WhatsApp app / template. */
  const waCanCloudApi = Boolean(waWindow?.open);
  const waCanAppFallback = Boolean(marketplaceLead && waPhone && !waCanCloudApi);
  const waCanFreeForm = !waOutbound || waCanCloudApi || waCanAppFallback;
  const needsTemplate = Boolean(waOutbound && waPhone && !waCanCloudApi);

  const templatesQuery = useQuery({
    queryKey: ["wa-templates", orgId],
    enabled: Boolean(waOutbound || templateModalOpen),
    queryFn: () => listWaTemplates(orgId),
    staleTime: 60_000,
  });

  const productsQuery = useQuery({
    queryKey: ["products", orgId],
    enabled: Boolean(waOutbound && (productModalOpen || waCanCloudApi)),
    queryFn: () => listProducts(orgId),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!selectedId) return;
    void markConversationRead(selectedId)
      .then(() => {
        queryClient.setQueriesData({ queryKey: ["conversations", orgId] }, (old: unknown) => {
          if (!Array.isArray(old)) return old;
          return (old as InboxConversation[]).map((c) =>
            c.id === selectedId ? { ...c, unread_count: 0 } : c,
          );
        });
        void queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
      })
      .catch(() => undefined);
  }, [selectedId, orgId, queryClient]);

  const updateLeadMutation = useMutation({
    mutationFn: async () => {
      if (!selected?.lead?.id) throw new Error("No lead linked to this conversation yet");
      return updateLeadStage(selected.lead.id, { status: leadStatus, priority: leadPriority });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
      toast.success("Lead updated from inbox");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not update lead");
    },
  });

  async function onSendReply() {
    if (!selected || !profile || !draft.trim()) return;
    if (waOutbound && !waPhone && marketplaceLead) {
      toast.error("No phone on this IndiaMART/TradeIndia lead — cannot contact via WhatsApp.");
      return;
    }
    if (waOutbound && !waCanCloudApi && !waCanAppFallback) {
      toast.error("WhatsApp 24h window closed — click Template to send an approved message.");
      setTemplateModalOpen(true);
      return;
    }
    setSending(true);
    try {
      const body = draft.trim();
      pinToBottom();
      const saved = await sendAgentMessage(
        selected.id,
        body,
        profile.id,
        orgId,
        profile.fullName || profile.email || "Human agent",
      );
      if (waOutbound && waCanCloudApi) {
        const { sendWhatsAppAgentReply } = await import("@/server/whatsapp");
        const result = await sendWhatsAppAgentReply({ data: { conversationId: selected.id, body } });
        if (result?.waMessageId) {
          await patchMessageMetadata(saved.id, {
            wa_message_id: result.waMessageId,
            wa_status: "sent",
          });
        }
      } else if (waCanAppFallback && waPhone) {
        window.open(whatsappMeUrl(waPhone, body), "_blank", "noopener,noreferrer");
      }
      if (selected.channel === "email") {
        const { sendEmailAgentReply } = await import("@/server/email");
        await sendEmailAgentReply({ data: { conversationId: selected.id, body } });
      }
      if (selected.channel === "facebook" || selected.channel === "instagram") {
        const { sendMetaAgentReply } = await import("@/server/meta-messenger");
        await sendMetaAgentReply({ data: { conversationId: selected.id, body } });
      }
      clearDraft(selected.id);
      pinToBottom();
      await queryClient.invalidateQueries({ queryKey: ["messages", selected.id] });
      await queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
      toast.success(
        waOutbound && waCanCloudApi
          ? "Reply sent on WhatsApp — AI paused for this conversation"
          : waCanAppFallback
            ? "Saved in Inbox and opened WhatsApp chat with this lead"
            : selected.channel === "email"
              ? "Reply sent by email — AI paused for this conversation"
              : selected.channel === "facebook"
                ? "Reply sent on Facebook — AI paused for this conversation"
                : selected.channel === "instagram"
                  ? "Reply sent on Instagram — AI paused for this conversation"
                  : "Human reply sent — AI paused for this conversation",
      );
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  async function onAttachFile(file: File) {
    if (!selected || !profile) return;
    if (waOutbound && !waCanCloudApi) {
      toast.error(
        marketplaceLead
          ? "Attachments via Cloud API need an open WhatsApp session. Send a template first, or share files in the WhatsApp app."
          : "WhatsApp 24h window closed — attachments need an open session. Send a template first.",
      );
      return;
    }
    setUploading(true);
    try {
      pinToBottom();
      const msg = await uploadAgentAttachment({
        conversationId: selected.id,
        orgId,
        profileId: profile.id,
        assigneeLabel: profile.fullName || profile.email || "Human agent",
        file,
      });
      const body = msg.body as string;
      const meta = (msg.metadata || {}) as Record<string, unknown>;
      const attachmentUrl = typeof meta.url === "string" ? meta.url : null;
      const fileName =
        (typeof meta.file_name === "string" && meta.file_name) || file.name || "file";
      const mimeType = typeof meta.mime_type === "string" ? meta.mime_type : file.type || undefined;
      if (waOutbound && waCanCloudApi) {
        const { sendWhatsAppAgentReply } = await import("@/server/whatsapp");
        const result = await sendWhatsAppAgentReply({
          data: {
            conversationId: selected.id,
            body,
            ...(attachmentUrl
              ? { attachment: { url: attachmentUrl, fileName, mimeType } }
              : {}),
          },
        });
        if (result?.waMessageId) {
          await patchMessageMetadata(msg.id, {
            wa_message_id: result.waMessageId,
            wa_status: "sent",
          });
        }
      }
      if (selected.channel === "email") {
        const { sendEmailAgentReply } = await import("@/server/email");
        await sendEmailAgentReply({ data: { conversationId: selected.id, body } });
      }
      if (selected.channel === "facebook" || selected.channel === "instagram") {
        const { sendMetaAgentReply } = await import("@/server/meta-messenger");
        await sendMetaAgentReply({ data: { conversationId: selected.id, body } });
      }
      await queryClient.invalidateQueries({ queryKey: ["messages", selected.id] });
      await queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
      pinToBottom();
      toast.success("Attachment shared in conversation");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (attachInputRef.current) attachInputRef.current.value = "";
    }
  }

  async function onSendTemplate(payload: {
    template: DbWaTemplate;
    bodyParams: string[];
    headerMediaUrl?: string;
    headerTextParams?: string[];
  }) {
    if (!selected || !profile || !waPhone) return;
    setSendingTemplate(true);
    try {
      await sendInboxWhatsAppTemplate({
        data: {
          conversationId: selected.id,
          templateId: payload.template.id,
          bodyParams: payload.bodyParams,
          headerMediaUrl: payload.headerMediaUrl,
          headerTextParams: payload.headerTextParams,
          profileId: profile.id,
          assigneeLabel: profile.fullName || profile.email || "Human agent",
        },
      });
      setTemplateModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["messages", selected.id] });
      await queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
      toast.success(`Template “${payload.template.name}” sent on WhatsApp`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to send template");
    } finally {
      setSendingTemplate(false);
    }
  }

  async function onRecommendProduct(product: DbProduct) {
    if (!selected || !profile || !waPhone) return;
    if (!waCanCloudApi) {
      toast.error("WhatsApp 24h window closed — send a template first, then recommend products.");
      setProductModalOpen(false);
      setTemplateModalOpen(true);
      return;
    }
    setSendingProduct(true);
    try {
      const { sendWhatsAppProductRecommendation } = await import("@/server/whatsapp");
      const result = await sendWhatsAppProductRecommendation({
        data: {
          conversationId: selected.id,
          productId: product.id,
          profileId: profile.id,
          assigneeLabel: profile.fullName || profile.email || "Human agent",
        },
      });
      setProductModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["messages", selected.id] });
      await queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
      toast.success(
        result.via === "image"
          ? `Sent “${product.name}” photo card on WhatsApp`
          : `Sent “${product.name}” as text (add a product image for photo cards)`,
      );
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to send product recommendation");
    } finally {
      setSendingProduct(false);
    }
  }

  async function onRefreshInbox() {
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations", orgId] }),
        selectedId
          ? queryClient.invalidateQueries({ queryKey: ["messages", selectedId] })
          : Promise.resolve(),
      ]);
      await conversationsQuery.refetch();
      if (selectedId) await messagesQuery.refetch();
      toast.success("Inbox refreshed");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Could not refresh inbox");
    }
  }

  async function onReturnToAi() {
    if (!selected) return;
    setReturningToAi(true);
    try {
      const { resumed } = await returnConversationToAi(selected.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations", orgId] }),
        queryClient.invalidateQueries({ queryKey: ["messages", selected.id] }),
        queryClient.invalidateQueries({ queryKey: ["handoff-queue", orgId] }),
      ]);
      toast.success(
        resumed
          ? "Returned to AI — EnerBot replied to the waiting customer message"
          : "Returned to AI — EnerBot will reply on the next customer message",
      );
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Return to AI failed");
    } finally {
      setReturningToAi(false);
    }
  }

  const refreshing = conversationsQuery.isFetching || messagesQuery.isFetching;

  const conversationList = (
    <CardPanel
      title="Chats"
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-none border-0 shadow-none"
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
    >
      <Toolbar
        placeholder="Search name, phone, preview…"
        value={listSearch}
        onChange={setListSearch}
        filter={null}
        sort={null}
      />
      <div className="-mx-0 flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setChannelFilter(f)}
            className={cn(
              "shrink-0 rounded-md border px-3 py-1.5 text-xs touch-manipulation",
              channelFilter === f
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
            )}
          >
            {f}
          </button>
              ))}
            </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {conversationsQuery.isLoading ? (
          <div className="p-3">
            <ListSkeleton rows={6} />
          </div>
        ) : conversationsQuery.isError ? (
          <div className="p-4">
            <EmptyState
              title="Could not load conversations"
              description={
                conversationsQuery.error instanceof Error
                  ? conversationsQuery.error.message
                  : "Check your connection and try again."
              }
              action={
                <Button size="sm" onClick={() => void conversationsQuery.refetch()}>
                  Retry
                </Button>
              }
            />
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No conversations yet"
              description={inboxEmptyDescription(channelFilter)}
            />
          </div>
        ) : (
            <ul className="divide-y divide-border">
            {conversations.map((c) => {
              const active = c.id === selectedId;
              const name = c.customer?.name || c.visitor_name || c.visitor_email || "Visitor";
              const viaWa = conversationRepliesViaWhatsApp(c);
              const listWa = viaWa
                ? getWhatsAppWindow(c.wa_last_customer_at || null, nowTick)
                : null;
              const listPhone = normalizeWhatsAppDigits(c.visitor_phone || c.customer?.phone);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openConversation(c.id)}
                    className={cn(
                      "w-full px-3 py-3.5 text-left touch-manipulation lg:py-3",
                      active ? "inbox-wa-list-item-active" : "hover:bg-black/5 dark:hover:bg-white/5",
                    )}
                  >
                  <div className="flex items-center gap-2.5">
                      <span className="inbox-wa-avatar size-10 text-sm" aria-hidden>
                        {(name.trim()[0] || "?").toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p
                            className={cn(
                              "min-w-0 flex-1 truncate text-sm",
                              c.unread_count > 0 ? "font-semibold text-foreground" : "font-medium",
                            )}
                          >
                            {name}
                          </p>
                          <span
                            className={cn(
                              "num shrink-0 text-[11px]",
                              c.unread_count > 0 ? "font-semibold text-[#00a884]" : "text-muted-foreground",
                            )}
                          >
                            {formatRelativeTime(c.last_message_at || c.created_at)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <p
                            className={cn(
                              "min-w-0 flex-1 truncate text-xs",
                              c.unread_count > 0 ? "font-medium text-foreground/80" : "text-muted-foreground",
                            )}
                          >
                            {cleanInboxPreview(c.preview)}
                          </p>
                          {c.unread_count > 0 ? (
                            <span className="inbox-wa-unread shrink-0">{c.unread_count}</span>
                          ) : null}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <ChannelIcon
                            channel={(c.channel as ChannelType) || "website"}
                            className="size-3.5 shrink-0 text-muted-foreground"
                          />
                          <Pill>{c.status}</Pill>
                          {isMarketplaceLeadChannel(c.channel) && listPhone ? (
                            <Pill tone="success">via WhatsApp</Pill>
                          ) : null}
                          {listWa ? (
                            <Pill tone={waTone(listWa.tone)} className="gap-1">
                              <Clock className="size-3" />
                              {listWa.open ? listWa.label : "WA closed"}
                            </Pill>
                          ) : null}
                          {(c.tags ?? []).slice(0, 2).map((t) => (
                            <Pill key={t}>{t}</Pill>
                          ))}
                        </div>
                      </div>
                  </div>
                  </button>
                </li>
              );
            })}
            </ul>
        )}
      </div>
    </CardPanel>
  );

  const threadTitle = selected
    ? `${selected.customer?.name || selected.visitor_name || "Visitor"}${
        selected.customer?.company || selected.visitor_company
          ? ` · ${selected.customer?.company || selected.visitor_company}`
          : ""
      }`
    : "Conversation";
  const threadInitial = (
    (selected?.customer?.name || selected?.visitor_name || "V").trim()[0] || "V"
  ).toUpperCase();

  const conversationThread = (
    <div className="inbox-wa-thread flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="inbox-wa-header shrink-0 border-b px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-9 shrink-0 touch-manipulation lg:hidden"
            onClick={backToMobileList}
            aria-label="Back to conversations"
          >
            <ArrowLeft className="size-4" />
          </Button>
          {selected ? (
            <span className="inbox-wa-avatar" aria-hidden>
              {threadInitial}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">{threadTitle}</h2>
            <p className="truncate text-xs opacity-70">
              {selected
                ? `${selected.channel}${
                    marketplaceLead && waPhone ? " · via WhatsApp" : ""
                  } · ${selected.external_ref || selected.id.slice(0, 8)} · ${selected.assignee_label || selected.status}`
                : "Select a conversation"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9 touch-manipulation lg:hidden"
              onClick={() => setProfileSheetOpen(true)}
              disabled={!selected}
              aria-label="Customer profile"
            >
              <User className="size-4" />
            </Button>
            {marketplaceLead ? (
              <Pill tone={waPhone ? "success" : "warning"} className="hidden gap-1.5 sm:inline-flex">
                {waPhone ? `WhatsApp · +${waPhone}` : "No phone for WhatsApp"}
              </Pill>
            ) : null}
            {waWindow ? (
              <Pill tone={waTone(waWindow.tone)} className="gap-1.5">
                <Clock className="size-3.5" />
                {waWindow.label}
              </Pill>
            ) : null}
            {showReturnToAi ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-9 touch-manipulation"
                disabled={returningToAi || sending}
                onClick={() => void onReturnToAi()}
                title="Return to AI"
                aria-label="Return to AI"
              >
                <Bot className={`size-4 ${returningToAi ? "animate-pulse" : ""}`} />
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {!selected ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          {selectedId && deepLinkQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Opening conversation…</p>
          ) : selectedId && deepLinkQuery.isError ? (
            <EmptyState
              title="Conversation not found"
              description="This thread may have been removed, or you don’t have access."
            />
          ) : (
            <EmptyState title="Select a conversation" description="Choose a thread from the left." />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            ref={messagesScrollRef}
            onScroll={onMessagesScroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:p-4"
          >
            <div className="space-y-3">
              {messagesQuery.isLoading ? (
                <ListSkeleton rows={4} />
              ) : messagesQuery.isError ? (
                <EmptyState
                  title="Could not load messages"
                  description={
                    messagesQuery.error instanceof Error
                      ? messagesQuery.error.message
                      : "Try refresh."
                  }
                  action={
                    <Button size="sm" onClick={() => void messagesQuery.refetch()}>
                      Retry
                    </Button>
                  }
                />
              ) : (messagesQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages in this thread yet.</p>
              ) : (
                <>
                {(messagesQuery.data ?? []).map((m, idx, all) => {
                  const isCustomer = m.sender === "customer";
                  const isSystem = m.sender === "system";
                  const isAi = m.sender === "ai";
                  const attach = messageAttachment(m);
                  const refImages = messageReferenceImages(m);
                  const waStatus = messageWaStatus(m);
                  const prev = idx > 0 ? all[idx - 1] : null;
                  const showDay = !prev || !sameCalendarDay(prev.created_at, m.created_at);
                  const caption = attach
                    ? m.body
                        .replace(attach.url, "")
                        .replace(/\n+/g, " ")
                        .replace(/^📷\s*Photo\s*/u, "")
                        .replace(/^📄\s*/u, "")
                        .replace(/^🎤\s*Voice note\s*/u, "")
                        .replace(/^🎬\s*Video\s*/u, "")
                        .replace(/^Shared (an image|a file):\s*/i, "")
                        .replace(/^Reference photo:\s*.*$/i, "")
                        .trim()
                    : m.body.replace(/!\[[^\]]*\]\([^)]+\)/g, "").trim();
                  const dayChip = showDay ? (
                    <div key={`day-${m.id}`} className="flex justify-center px-2 py-1.5">
                      <span className="inbox-wa-day rounded-lg px-3 py-1 text-[11px] font-medium uppercase tracking-wide">
                        {dayDividerLabel(m.created_at)}
                      </span>
                    </div>
                  ) : null;
                  if (isSystem) {
                    return (
                      <div key={m.id}>
                        {dayChip}
                        <div className="flex justify-center px-2">
                          <p className="inbox-wa-bubble-system max-w-[90%] rounded-lg px-3 py-1.5 text-center text-xs">
                            {caption || m.body}
                            <span className="num mt-0.5 block text-[10px] opacity-80">
                              {formatClock(m.created_at)}
                            </span>
                          </p>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={m.id}>
                      {dayChip}
                      <div className={isCustomer ? "flex justify-start" : "flex justify-end"}>
                      <div className="max-w-[min(88%,28rem)] sm:max-w-[min(78%,28rem)]">
                        <div
                          className={cn(
                            "px-2.5 py-1.5 text-[15px] leading-snug sm:text-sm",
                            isCustomer
                              ? "inbox-wa-bubble-in"
                              : isAi
                                ? "inbox-wa-bubble-ai"
                                : "inbox-wa-bubble-out",
                          )}
                        >
                          {attach?.isImage ? (
                            <a href={attach.url} target="_blank" rel="noreferrer" className="block">
                              <img
                                src={attach.url}
                                alt={attach.fileName || "Photo"}
                                className="mb-1 max-h-56 max-w-full rounded-lg object-contain"
                                loading="lazy"
                              />
                              {caption ? <p className="whitespace-pre-wrap">{caption}</p> : null}
                            </a>
                          ) : attach?.isVideo ? (
                            <div className="space-y-1">
                              <video
                                src={attach.url}
                                controls
                                className="max-h-56 max-w-full rounded-lg bg-black/10"
                              />
                              {caption ? <p className="whitespace-pre-wrap">{caption}</p> : null}
                            </div>
                          ) : attach?.isAudio ? (
                            <div className="space-y-1">
                              <audio src={attach.url} controls className="w-full max-w-xs" />
                              {caption ? <p className="whitespace-pre-wrap text-xs opacity-90">{caption}</p> : null}
                            </div>
                          ) : attach ? (
                            <p>
                              {caption ? `${caption} — ` : null}
                              <a
                                href={attach.url}
                                target="_blank"
                                rel="noreferrer"
                                className="underline opacity-90"
                              >
                                {attach.fileName}
                              </a>
                            </p>
                          ) : (
                            <p className="whitespace-pre-wrap">{caption || m.body}</p>
                          )}
                          {refImages.length > 0 ? (
                            <div className="mt-2 space-y-2">
                              {refImages.map((img) => (
                                <a
                                  key={img.url}
                                  href={img.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block overflow-hidden rounded-lg bg-black/10"
                                >
                                  <img
                                    src={img.url}
                                    alt="Reference photo"
                                    className="max-h-48 w-full object-cover"
                                    loading="lazy"
                                  />
                                </a>
                              ))}
                            </div>
                          ) : null}
                          <div className="inbox-wa-meta mt-1 flex items-center justify-end gap-1 text-[10px] leading-none">
                            <span className="num opacity-90">{formatClock(m.created_at)}</span>
                            {!isCustomer ? (
                              <span className="capitalize opacity-80">
                                {isAi ? "AI" : "You"}
                              </span>
                            ) : null}
                            {!isCustomer && waStatus === "failed" ? (
                              <span className="text-destructive">Failed</span>
                            ) : !isCustomer &&
                              (waStatus === "read" || waStatus === "delivered" || waStatus === "sent") ? (
                              <span
                                className={cn(
                                  "inline-flex items-center",
                                  waStatus === "read" ? "inbox-wa-tick-read" : "inbox-wa-tick",
                                )}
                                title={waStatus}
                              >
                                {waStatus === "sent" ? (
                                  <Check className="size-3.5" />
                                ) : (
                                  <CheckCheck className="size-3.5" />
                                )}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} aria-hidden className="h-px w-full shrink-0" />
                </>
              )}
            </div>
          </div>

          <div className="inbox-wa-composer z-10 shrink-0 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3">
            {marketplaceLead && !waPhone ? (
              <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="font-medium text-destructive">No mobile number on this lead</p>
                <p className="mt-1 hidden text-xs text-muted-foreground sm:block">
                  IndiaMART/TradeIndia contact medium is WhatsApp by default — add a phone on the lead to reply.
                </p>
              </div>
            ) : null}
            {needsTemplate ? (
              <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-sm sm:p-3">
                <p className="font-medium text-foreground">
                  {marketplaceLead
                    ? "Send a WhatsApp template to start"
                    : "WhatsApp window closed — use Template"}
                </p>
                <p className="mt-1 hidden text-xs text-muted-foreground sm:block">
                  Free-form text is blocked by Meta. Open the template picker from the composer (same
                  row as attach), choose an approved template, then send.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setTemplateModalOpen(true)}>
                    <LayoutGrid className="size-3.5" />
                    Send template
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="hidden sm:inline-flex"
                    onClick={() => void navigate({ to: "/broadcasting" })}
                  >
                    Manage templates
                  </Button>
                  {waPhone ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        window.open(whatsappMeUrl(waPhone, draft || undefined), "_blank", "noopener,noreferrer")
                      }
                    >
                      <ExternalLink className="size-3.5" />
                      WhatsApp app
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="flex items-end gap-1.5">
              <input
                ref={attachInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onAttachFile(file);
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-10 shrink-0 touch-manipulation sm:size-9"
                aria-label="Attach"
                disabled={uploading || sending || sendingTemplate || sendingProduct || !waCanFreeForm}
                onClick={() => attachInputRef.current?.click()}
              >
                <Paperclip className={`size-4 ${uploading ? "animate-pulse" : ""}`} />
              </Button>
              {waOutbound && waPhone ? (
                <Button
                  variant={needsTemplate ? "default" : "ghost"}
                  size="icon"
                  className="size-10 shrink-0 touch-manipulation sm:size-9"
                  aria-label="Send WhatsApp template"
                  title="Send WhatsApp template"
                  disabled={sending || uploading || sendingTemplate || sendingProduct}
                  onClick={() => setTemplateModalOpen(true)}
                >
                  <LayoutGrid className="size-4" />
                </Button>
              ) : null}
              {waOutbound && waPhone ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 shrink-0 touch-manipulation sm:size-9"
                  aria-label="Recommend product"
                  title={
                    waCanCloudApi
                      ? "Recommend a product card on WhatsApp"
                      : "Needs open 24h WhatsApp window"
                  }
                  disabled={sending || uploading || sendingTemplate || sendingProduct || !waCanCloudApi}
                  onClick={() => setProductModalOpen(true)}
                >
                  <Package className="size-4" />
                </Button>
              ) : null}
              <Textarea
                className="inbox-wa-composer-input min-h-10 max-h-32 min-w-0 flex-1 resize-none border-0 py-2.5 text-base shadow-none focus-visible:ring-0 sm:text-sm"
                rows={1}
                placeholder={
                  needsTemplate
                    ? "Free-form blocked — click Template…"
                    : uploading
                      ? "Uploading…"
                      : "Type a message"
                }
                aria-label="Reply"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void onSendReply();
                  }
                }}
                disabled={sending || uploading || sendingTemplate || sendingProduct || !waCanFreeForm}
              />
              <Button
                size="icon"
                className="inbox-wa-send size-10 shrink-0 touch-manipulation sm:size-9"
                aria-label="Send"
                onClick={() => void onSendReply()}
                disabled={sending || uploading || sendingTemplate || sendingProduct || !draft.trim() || !waCanFreeForm}
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const profileSidebar = (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-1">
      <CardPanel title="Customer Profile" className="shrink-0">
        {selected ? (
          <>
            <dl className="space-y-2 text-sm">
              {[
                ["Name", selected.customer?.name || selected.visitor_name || "—"],
                ["Company", selected.customer?.company || selected.visitor_company || "—"],
                ["Phone", formatDisplayPhone(selected.customer?.phone || selected.visitor_phone) || "—"],
                ["Email", selected.customer?.email || selected.visitor_email || "—"],
                ["Assigned", selected.assignee_label || "—"],
                ["Status", selected.status],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="truncate font-medium">{v}</dd></div>
              ))}
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void navigate({ to: "/customers" })}><ExternalLink className="size-3.5" /> Open customers</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void navigate({ to: "/leads" })}><ExternalLink className="size-3.5" /> Open leads</Button>
            </div>
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-2 text-xs text-muted-foreground">Linked records</p>
              <dl className="space-y-2 text-sm">
                {[
                  ["Customer ID", selected.customer?.id?.slice(0, 8) || "—"],
                  ["Lead ID", selected.lead?.id?.slice(0, 8) || "—"],
                  ["Lead name", selected.lead?.name || "—"],
                  ["Interest", selected.lead?.product_label || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="truncate font-medium">{v}</dd></div>
                ))}
              </dl>
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 text-xs text-muted-foreground">Lead workflow from conversation</p>
              {selected.lead ? (
                <div className="space-y-3">
                  <div className="space-y-2"><p className="text-xs text-muted-foreground">Lead status</p><Select value={leadStatus} onValueChange={(value: LeadStatus) => setLeadStatus(value)}><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger><SelectContent>{leadStatuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><p className="text-xs text-muted-foreground">Priority</p><Select value={leadPriority} onValueChange={(value: PriorityLevel) => setLeadPriority(value)}><SelectTrigger><SelectValue placeholder="Select priority" /></SelectTrigger><SelectContent>{leadPriorities.map((priority) => <SelectItem key={priority} value={priority}>{priority}</SelectItem>)}</SelectContent></Select></div>
                  <Button size="sm" className="w-full" onClick={() => updateLeadMutation.mutate()} disabled={updateLeadMutation.isPending}>{updateLeadMutation.isPending ? "Saving…" : "Update lead from inbox"}</Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">This conversation does not have a linked lead yet.</p>
              )}
            </div>
            <div className="mt-4"><p className="mb-1 text-xs text-muted-foreground">AI confidence</p><ScoreBar score={Math.round((selected.confidence ?? 0.7) * 100)} /></div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Select a conversation to see profile.</p>
        )}
      </CardPanel>
      <CardPanel title="Conversation Summary" className="shrink-0">
        <p className="text-sm text-muted-foreground">{selected?.preview || "Summary will appear as the thread grows. Full AI summaries come in the AI phase."}</p>
      </CardPanel>
      <CardPanel title="Channel" className="shrink-0">
        <p className="text-sm text-muted-foreground">{selected ? `${selected.channel} · session ${selected.widget_session_id?.slice(0, 8) || "—"}` : "—"}</p>
      </CardPanel>
    </div>
  );

  return (
    <div className="inbox-wa flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className={cn("shrink-0", mobileThreadOpen && "hidden lg:block")}>
        <PageHeader
          title="Omnichannel Inbox"
          description="Chats rise to the top when there is a new reply — WhatsApp-style."
          actions={
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 touch-manipulation"
              onClick={() => void onRefreshInbox()}
              disabled={refreshing}
            >
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} /> Refresh
            </Button>
          }
        />
      </div>

      {/* Desktop: 3-pane workspace */}
      <div className="relative hidden min-h-0 flex-1 overflow-hidden p-3 md:p-4 lg:block">
        {layout ? (
          <div className="absolute inset-3 overflow-hidden rounded-xl border border-border bg-card md:inset-4">
            <ResizablePanelGroup
              id="inbox-workspace"
              orientation="horizontal"
              className="h-full w-full"
              defaultLayout={layout}
              onLayoutChanged={(next) => {
                setLayout(next);
                localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
              }}
            >
              <ResizablePanel
                id="list"
                defaultSize="24%"
                minSize="16%"
                maxSize="42%"
                className="min-h-0 min-w-0"
              >
                <div className="flex h-full min-h-0 flex-col overflow-hidden border-r border-border">
                  {conversationList}
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="chat" defaultSize="48%" minSize="28%" className="min-h-0 min-w-0">
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                  {isLg ? conversationThread : null}
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="profile"
                defaultSize="28%"
                minSize="18%"
                maxSize="40%"
                collapsible
                className="min-h-0 min-w-0"
              >
                <div className="h-full min-h-0 overflow-hidden border-l border-border">
                  {profileSidebar}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        ) : (
          <div className="absolute inset-3 rounded-xl border border-border md:inset-4">
            <ListSkeleton rows={8} />
          </div>
        )}
      </div>

      {/* Mobile / tablet: list OR full-screen thread (sales on the road) */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:hidden">
        {!mobileThreadOpen ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border bg-card">
            {conversationList}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border bg-card">
            {!isLg ? conversationThread : null}
        </div>
        )}
      </div>

      <Sheet open={profileSheetOpen} onOpenChange={setProfileSheetOpen}>
        <SheetContent side="bottom" className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 lg:hidden">
          <SheetHeader className="shrink-0 border-b border-border px-4 py-3 text-left">
            <SheetTitle>Customer & lead</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{profileSidebar}</div>
        </SheetContent>
      </Sheet>

      <SendWhatsAppTemplateDialog
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        templates={templatesQuery.data ?? []}
        loading={templatesQuery.isLoading}
        contactName={
          selected?.customer?.name || selected?.visitor_name || selected?.lead?.name || null
        }
        contactPhone={waPhone}
        sending={sendingTemplate}
        onSend={onSendTemplate}
        onManageTemplates={() => {
          setTemplateModalOpen(false);
          void navigate({ to: "/broadcasting" });
        }}
      />

      <RecommendProductDialog
        open={productModalOpen}
        onOpenChange={setProductModalOpen}
        products={productsQuery.data ?? []}
        loading={productsQuery.isLoading}
        contactName={
          selected?.customer?.name || selected?.visitor_name || selected?.lead?.name || null
        }
        contactPhone={waPhone}
        sending={sendingProduct}
        onSend={onRecommendProduct}
        onManageProducts={() => {
          setProductModalOpen(false);
          void navigate({ to: "/products" });
        }}
      />
    </div>
  );
}
