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
import { ExternalLink, Paperclip, RefreshCw, Send, Sparkles } from "lucide-react";
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
import type { ChannelType, DbMessage, LeadStatus, PriorityLevel } from "@/lib/db-types";
import { updateLeadStage } from "@/lib/leads-api";
import { cn } from "@/lib/utils";

const filters = ["All", "Unread", "Assigned", "Website", "WhatsApp", "Instagram", "Facebook", "Email"];
const leadStatuses: LeadStatus[] = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"];
const leadPriorities: PriorityLevel[] = ["High", "Medium", "Low"];
const LAYOUT_KEY = "enertech-inbox-layout-v1";

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
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [leadStatus, setLeadStatus] = useState<LeadStatus>("New");
  const [leadPriority, setLeadPriority] = useState<PriorityLevel>("Medium");
  const [layout, setLayout] = useState<Record<string, number> | undefined>(undefined);

  useEffect(() => {
    setLayout(loadLayout() ?? { list: 24, chat: 48, profile: 28 });
  }, []);

  const conversationsQuery = useQuery({
    queryKey: ["conversations", orgId],
    queryFn: () => listConversations(orgId),
    refetchInterval: 5000,
  });

  const conversations = useMemo(() => {
    const all = conversationsQuery.data ?? [];
    if (channelFilter === "All" || channelFilter === "Unread" || channelFilter === "Assigned") {
      if (channelFilter === "Unread") return all.filter((c) => c.unread_count > 0);
      if (channelFilter === "Assigned") return all.filter((c) => Boolean(c.assignee_id || c.assignee_label));
      return all;
    }
    return all.filter((c) => c.channel === channelFilter.toLowerCase());
  }, [conversationsQuery.data, channelFilter]);

  useEffect(() => {
    if (deepLinkId) setSelectedId(deepLinkId);
  }, [deepLinkId]);

  useEffect(() => {
    if (!selectedId && conversations.length > 0) setSelectedId(conversations[0].id);
  }, [conversations, selectedId]);

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
      if (selected.channel === "whatsapp") {
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
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["messages", selected.id] });
      await queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
      toast.success(
        selected.channel === "whatsapp"
          ? "Reply sent on WhatsApp — AI paused for this conversation"
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
      // Push file link on external channels when possible
      if (selected.channel === "whatsapp") {
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
    <CardPanel title="Conversations" className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 shadow-none" bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
      <Toolbar placeholder="Search conversations…" />
      <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setChannelFilter(f)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px]",
              channelFilter === f
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
            )}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversationsQuery.isLoading ? (
          <div className="p-3"><ListSkeleton rows={6} /></div>
        ) : conversations.length === 0 ? (
          <div className="p-4"><EmptyState title="No conversations yet" description="Open Website chat and send a message — it will appear here." /></div>
        ) : (
          <ul className="divide-y divide-border">
            {conversations.map((c) => {
              const active = c.id === selectedId;
              const name = c.customer?.name || c.visitor_name || c.visitor_email || "Visitor";
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => setSelectedId(c.id)} className={cn("w-full px-3 py-3 text-left", active ? "bg-secondary/70" : "hover:bg-secondary/40")}>
                    <div className="flex items-center gap-2">
                      <ChannelIcon channel={(c.channel as ChannelType) || "website"} className="shrink-0 text-muted-foreground" />
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
                      <span className="num shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(c.last_message_at || c.created_at)}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{c.preview || "No messages yet"}</p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Pill>{c.status}</Pill>
                      {(c.tags ?? []).slice(0, 2).map((t) => <Pill key={t}>{t}</Pill>)}
                      {c.unread_count > 0 && <Pill tone="primary" className="ml-auto">{c.unread_count}</Pill>}
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
    <CardPanel
      title={selected ? `${selected.customer?.name || selected.visitor_name || "Visitor"}${selected.customer?.company || selected.visitor_company ? ` · ${selected.customer?.company || selected.visitor_company}` : ""}` : "Conversation"}
      description={selected ? `${selected.channel} · ${selected.external_ref || selected.id.slice(0, 8)} · ${selected.assignee_label || selected.status}` : "Select a conversation"}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 shadow-none"
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
    >
      {!selected ? (
        <div className="p-6"><EmptyState title="Select a conversation" description="Choose a thread from the left." /></div>
      ) : (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
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
                  <div key={m.id} className={isCustomer ? "flex justify-start" : "flex justify-end"}>
                    <div className="max-w-[min(78%,28rem)]">
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
                                isCustomer
                                  ? "underline"
                                  : "underline text-primary-foreground"
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
          <div className="z-10 shrink-0 border-t border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-primary"><Sparkles className="size-3.5" /> Reply as {profile?.fullName || "agent"} — saved to this conversation</div>
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
                className="size-9 shrink-0"
                aria-label="Attach"
                disabled={uploading || sending}
                onClick={() => attachInputRef.current?.click()}
              >
                <Paperclip className={`size-4 ${uploading ? "animate-pulse" : ""}`} />
              </Button>
              <Input
                className="h-9"
                placeholder={uploading ? "Uploading…" : "Write a reply…"}
                aria-label="Reply"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void onSendReply();
                  }
                }}
                disabled={sending || uploading}
              />
              <Button
                size="icon"
                className="size-9 shrink-0"
                aria-label="Send"
                onClick={() => void onSendReply()}
                disabled={sending || uploading || !draft.trim()}
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </CardPanel>
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
      <div className="shrink-0">
        <PageHeader
          title="Omnichannel Inbox"
          description="Live conversations from website chat and other channels."
          actions={
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void onRefreshInbox()} disabled={refreshing}>
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} /> Refresh
            </Button>
          }
        />
      </div>

      {/* Desktop / tablet: resizable 3-column workspace */}
      <div className="hidden min-h-0 flex-1 flex-col overflow-hidden p-3 md:p-4 lg:flex">
        {layout ? (
          <ResizablePanelGroup
            id="inbox-workspace"
            orientation="horizontal"
            className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card"
            defaultLayout={layout}
            onLayoutChanged={(next) => {
              setLayout(next);
              localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
            }}
          >
            <ResizablePanel id="list" defaultSize="24%" minSize="16%" maxSize="42%" className="min-h-0 min-w-0">
              <div className="h-full min-h-0 overflow-hidden border-r border-border">{conversationList}</div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="chat" defaultSize="48%" minSize="28%" className="min-h-0 min-w-0">
              <div className="h-full min-h-0 overflow-hidden">{conversationThread}</div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="profile" defaultSize="28%" minSize="18%" maxSize="40%" collapsible className="min-h-0 min-w-0">
              <div className="h-full min-h-0 overflow-hidden border-l border-border">{profileSidebar}</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="min-h-0 flex-1 rounded-xl border border-border"><ListSkeleton rows={8} /></div>
        )}
      </div>

      {/* Mobile: stacked panels */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 lg:hidden">
        <div className="max-h-[32vh] min-h-[180px] shrink-0 overflow-hidden rounded-xl border border-border">{conversationList}</div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border">{conversationThread}</div>
      </div>
    </div>
  );
}
