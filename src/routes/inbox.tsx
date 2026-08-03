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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, ExternalLink, LayoutGrid, Package, Paperclip, RefreshCw, Send, ArrowLeft, User } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  ENERTECH_ORG_ID,
  formatClock,
  formatRelativeTime,
  listConversations,
  listMessages,
  markConversationRead,
  sendAgentMessage,
  uploadAgentAttachment,
} from "@/lib/chat-api";
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
import { RecommendProductDialog } from "@/components/inbox/RecommendProductDialog";
import { SendWhatsAppTemplateDialog } from "@/components/inbox/SendWhatsAppTemplateDialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const filters = ["All", "Unread", "Assigned", "Website", "WhatsApp", "IndiaMART", "TradeIndia", "Instagram", "Facebook", "Email"];
const leadStatuses: LeadStatus[] = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"];
const leadPriorities: PriorityLevel[] = ["High", "Medium", "Low"];
const LAYOUT_KEY = "enertech-inbox-layout-v1";

function waTone(tone: WhatsAppWindowState["tone"]): "success" | "warning" | "danger" | "neutral" | "primary" {
  if (tone === "ok") return "success";
  if (tone === "warn") return "warning";
  if (tone === "critical" || tone === "closed") return "danger";
  return "neutral";
}

function messageAttachment(m: DbMessage): { url: string; fileName: string; isImage: boolean } | null {
  const meta = (m.metadata || {}) as Record<string, unknown>;
  const url = typeof meta.url === "string" ? meta.url : null;
  const fileName =
    (typeof meta.file_name === "string" && meta.file_name) ||
    (url ? decodeURIComponent(url.split("/").pop() || "file") : "file");
  if (url) {
    const isImage =
      String(meta.mime_type || "").startsWith("image/") ||
      /\.(png|jpe?g|webp|gif)(\?|$)/i.test(fileName) ||
      /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
    return { url, fileName, isImage };
  }
  if (meta.attachment) {
    const match = m.body.match(/https?:\/\/\S+/);
    if (match) {
      return {
        url: match[0],
        fileName,
        isImage: /\.(png|jpe?g|webp|gif)(\?|$)/i.test(match[0]),
      };
    }
  }
  return null;
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
        content: "Every website, WhatsApp, email, Instagram and Facebook conversation in one shared workspace.",
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
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [sendingProduct, setSendingProduct] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [leadStatus, setLeadStatus] = useState<LeadStatus>("New");
  const [leadPriority, setLeadPriority] = useState<PriorityLevel>("Medium");
  const [layout, setLayout] = useState<Record<string, number> | undefined>(undefined);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    setLayout(loadLayout() ?? { list: 24, chat: 48, profile: 28 });
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const conversationsQuery = useQuery({
    queryKey: ["conversations", orgId],
    queryFn: () => listConversations(orgId),
    refetchInterval: 5000,
  });

  const conversations = useMemo(() => {
    const all = conversationsQuery.data ?? [];
    let rows = all;
    if (channelFilter === "Unread") rows = all.filter((c) => c.unread_count > 0);
    else if (channelFilter === "Assigned") {
      rows = all.filter((c) => Boolean(c.assignee_id || c.assignee_label));
    } else if (channelFilter !== "All") {
      rows = all.filter((c) => c.channel === channelFilter.toLowerCase());
    }
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
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [conversationsQuery.data, channelFilter, listSearch]);

  useEffect(() => {
    if (deepLinkId) {
      setSelectedId(deepLinkId);
      setMobileThreadOpen(true);
    }
  }, [deepLinkId]);

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

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

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

  const lastCustomerMessageAt = useMemo(() => {
    const msgs = messagesQuery.data ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].sender === "customer") return msgs[i].created_at;
    }
    return null;
  }, [messagesQuery.data]);

  const waOutbound = Boolean(selected && conversationRepliesViaWhatsApp(selected));
  const waPhone = selected ? normalizeWhatsAppDigits(selected.visitor_phone) : null;
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
      .then(() => queryClient.invalidateQueries({ queryKey: ["conversations", orgId] }))
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
      await sendAgentMessage(
        selected.id,
        body,
        profile.id,
        orgId,
        profile.fullName || profile.email || "Human agent",
      );
      if (waOutbound && waCanCloudApi) {
        const { sendWhatsAppAgentReply } = await import("@/server/whatsapp");
        await sendWhatsAppAgentReply({ data: { conversationId: selected.id, body } });
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
      setDraft("");
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
      const msg = await uploadAgentAttachment({
        conversationId: selected.id,
        orgId,
        profileId: profile.id,
        assigneeLabel: profile.fullName || profile.email || "Human agent",
        file,
      });
      const body = msg.body as string;
      if (waOutbound && waCanCloudApi) {
        const { sendWhatsAppAgentReply } = await import("@/server/whatsapp");
        await sendWhatsAppAgentReply({ data: { conversationId: selected.id, body } });
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

  const refreshing = conversationsQuery.isFetching || messagesQuery.isFetching;

  const conversationList = (
    <CardPanel
      title="Conversations"
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
        ) : conversations.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No conversations yet"
              description="Open Website chat and send a message — it will appear here."
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
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openConversation(c.id)}
                    className={cn(
                      "w-full px-3 py-3.5 text-left touch-manipulation active:bg-secondary/80 lg:py-3",
                      active ? "bg-secondary/70" : "hover:bg-secondary/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <ChannelIcon
                        channel={(c.channel as ChannelType) || "website"}
                        className="shrink-0 text-muted-foreground"
                      />
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
                      <span className="num shrink-0 text-[11px] text-muted-foreground">
                        {formatRelativeTime(c.last_message_at || c.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {c.preview || "No messages yet"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Pill>{c.status}</Pill>
                      {isMarketplaceLeadChannel(c.channel) &&
                      normalizeWhatsAppDigits(c.visitor_phone) ? (
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
                      {c.unread_count > 0 && (
                        <Pill tone="primary" className="ml-auto">
                          {c.unread_count}
                        </Pill>
                      )}
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

  const conversationThread = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <header className="shrink-0 border-b border-border px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex items-start gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="mt-0.5 size-9 shrink-0 touch-manipulation lg:hidden"
            onClick={backToMobileList}
            aria-label="Back to conversations"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {selected
                ? `${selected.customer?.name || selected.visitor_name || "Visitor"}${
                    selected.customer?.company || selected.visitor_company
                      ? ` · ${selected.customer?.company || selected.visitor_company}`
                      : ""
                  }`
                : "Conversation"}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {selected
                ? `${selected.channel}${
                    marketplaceLead && waPhone ? " · contact via WhatsApp" : ""
                  } · ${selected.external_ref || selected.id.slice(0, 8)} · ${selected.assignee_label || selected.status}`
                : "Select a conversation"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <Button
              type="button"
              size="icon"
              variant="outline"
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
          </div>
        </div>
      </header>

      {!selected ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState title="Select a conversation" description="Choose a thread from the left." />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:p-4">
            <div className="space-y-3">
              {messagesQuery.isLoading ? (
                <ListSkeleton rows={4} />
              ) : (messagesQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages in this thread yet.</p>
              ) : (
                (messagesQuery.data ?? []).map((m) => {
                  const isCustomer = m.sender === "customer";
                  const attach = messageAttachment(m);
                  const caption = attach
                    ? m.body.replace(attach.url, "").replace(/\n+/g, " ").trim()
                    : m.body;
                  return (
                    <div
                      key={m.id}
                      className={isCustomer ? "flex justify-start" : "flex justify-end"}
                    >
                      <div className="max-w-[min(88%,28rem)] sm:max-w-[min(78%,28rem)]">
                        <div
                          className={
                            isCustomer
                              ? "rounded-xl bg-secondary px-3 py-2 text-sm"
                              : "rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground"
                          }
                        >
                          {attach?.isImage ? (
                            <a href={attach.url} target="_blank" rel="noreferrer" className="block">
                              <img
                                src={attach.url}
                                alt={attach.fileName}
                                className="mb-1 max-h-48 max-w-full rounded-lg object-contain"
                              />
                              {caption ? <p>{caption}</p> : null}
                            </a>
                          ) : attach ? (
                            <p>
                              {caption ? `${caption} — ` : null}
                              <a
                                href={attach.url}
                                target="_blank"
                                rel="noreferrer"
                                className={
                                  isCustomer ? "underline" : "underline text-primary-foreground"
                                }
                              >
                                {attach.fileName}
                              </a>
                            </p>
                          ) : (
                            m.body
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="num">{formatClock(m.created_at)}</span>
                          <span className="capitalize">{m.sender}</span>
                          {m.confidence != null ? (
                            <Pill tone="success">conf {Number(m.confidence).toFixed(2)}</Pill>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="z-10 shrink-0 border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
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
            <div className="flex items-center gap-1.5">
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
              <Input
                className="h-10 min-w-0 flex-1 text-base sm:h-9 sm:text-sm"
                placeholder={
                  needsTemplate
                    ? "Free-form blocked — click Template…"
                    : uploading
                      ? "Uploading…"
                      : "Write a reply…"
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
                className="size-10 shrink-0 touch-manipulation sm:size-9"
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
                ["Phone", selected.customer?.phone || selected.visitor_phone || "—"],
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
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className={cn("shrink-0", mobileThreadOpen && "hidden lg:block")}>
        <PageHeader
          title="Omnichannel Inbox"
          description="Live conversations from website chat and other channels."
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
                <div className="flex h-full min-h-0 flex-col overflow-hidden">{conversationThread}</div>
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
            {conversationThread}
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
