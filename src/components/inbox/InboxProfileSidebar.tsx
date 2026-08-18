import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel as CardPanel, Pill } from "@/components/shared/ui-kit";
import {
  claimConversation,
  returnConversationToAi,
  transferConversation,
  updateConversationInternalNote,
  updateConversationTags,
  type InboxConversation,
} from "@/lib/chat-api";
import { listOrgSalesPeople } from "@/lib/leads-api";
import {
  INBOX_LABEL_PRESETS,
  conversationMeta,
  normalizeConversationTags,
  readInternalNote,
} from "@/lib/inbox-snooze";
import { formatDisplayPhone } from "@/lib/phone-country";
import type { LeadStatus, PriorityLevel } from "@/lib/db-types";

const AI_ASSIGN = "__ai__";
const leadStatuses: LeadStatus[] = [
  "New",
  "Contacted",
  "Qualified",
  "Proposal",
  "Negotiation",
  "Won",
  "Lost",
];
const leadPriorities: PriorityLevel[] = ["Low", "Medium", "High"];

function inboxAiSummary(c: InboxConversation | null | undefined): string {
  if (!c?.metadata || typeof c.metadata !== "object") return "";
  const raw = (c.metadata as Record<string, unknown>).ai_summary;
  return typeof raw === "string" ? raw.trim() : "";
}

export function InboxProfileSidebar({
  selected,
  orgId,
  profileId,
  profileName,
  leadStatus,
  leadPriority,
  onLeadStatusChange,
  onLeadPriorityChange,
  onUpdateLead,
  updatingLead,
  pushFollowUpToBrainmine,
  onPushFollowUpChange,
  summaryDraft,
  onSummaryDraftChange,
  onGenerateSummary,
  generatingSummary,
  onSaveSummary,
  savingSummary,
}: {
  selected: InboxConversation | null;
  orgId: string;
  profileId?: string;
  profileName?: string;
  leadStatus: LeadStatus;
  leadPriority: PriorityLevel;
  onLeadStatusChange: (value: LeadStatus) => void;
  onLeadPriorityChange: (value: PriorityLevel) => void;
  onUpdateLead: () => void;
  updatingLead: boolean;
  pushFollowUpToBrainmine: boolean;
  onPushFollowUpChange: (value: boolean) => void;
  summaryDraft: string;
  onSummaryDraftChange: (value: string) => void;
  onGenerateSummary: () => void;
  generatingSummary: boolean;
  onSaveSummary: () => void;
  savingSummary: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tagDraft, setTagDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");

  const staffQuery = useQuery({
    queryKey: ["org-agents", orgId],
    enabled: Boolean(orgId),
    queryFn: () => listOrgSalesPeople(orgId),
    staleTime: 60_000,
  });

  useEffect(() => {
    setTagDraft("");
    setNoteDraft(selected ? readInternalNote(conversationMeta(selected.metadata)) : "");
  }, [selected?.id]);

  const tags = normalizeConversationTags(selected?.tags);
  const staff = staffQuery.data ?? [];
  const assignValue = selected?.assignee_id
    ? selected.assignee_id
    : selected?.status === "ai"
      ? AI_ASSIGN
      : "__queue__";
  const savedNote = selected ? readInternalNote(conversationMeta(selected.metadata)) : "";

  async function refreshThread() {
    if (!selected) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["conversations", orgId] }),
      queryClient.invalidateQueries({ queryKey: ["messages", selected.id] }),
      queryClient.invalidateQueries({ queryKey: ["handoff-queue", orgId] }),
    ]);
  }

  const assignMutation = useMutation({
    mutationFn: async (value: string): Promise<"ai" | "human" | "noop"> => {
      if (!selected) throw new Error("No conversation");
      if (value === "__queue__") return "noop";
      if (value === AI_ASSIGN) {
        if (selected.status === "ai") return "noop";
        await returnConversationToAi(selected.id);
        return "ai";
      }
      if (value === selected.assignee_id) return "noop";
      const person = staff.find((p) => p.id === value);
      const label = person?.name || profileName || "Human agent";
      if (value === profileId) {
        await claimConversation({
          conversationId: selected.id,
          profileId: value,
          assigneeLabel: label,
        });
        return "human";
      }
      await transferConversation({
        conversationId: selected.id,
        profileId: value,
        assigneeLabel: label,
      });
      return "human";
    },
    onSuccess: async (result) => {
      if (result === "noop") return;
      await refreshThread();
      toast.success(result === "ai" ? "Returned to EnerBot" : "Assigned");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not assign"),
  });

  const tagsMutation = useMutation({
    mutationFn: (next: string[]) => {
      if (!selected) throw new Error("No conversation");
      return updateConversationTags(selected.id, next);
    },
    onSuccess: async () => {
      await refreshThread();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save labels"),
  });

  const noteMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("No conversation");
      return updateConversationInternalNote(selected.id, noteDraft);
    },
    onSuccess: async () => {
      await refreshThread();
      toast.success("Note saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save note"),
  });

  function addTag(raw: string) {
    const tag = raw.trim();
    if (!tag || !selected) return;
    const next = normalizeConversationTags([...tags, tag]);
    if (next.length === tags.length && next.every((t, i) => t.toLowerCase() === (tags[i] || "").toLowerCase())) {
      setTagDraft("");
      return;
    }
    tagsMutation.mutate(next);
    setTagDraft("");
  }

  function removeTag(tag: string) {
    tagsMutation.mutate(tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()));
  }

  function togglePreset(tag: string) {
    const has = tags.some((t) => t.toLowerCase() === tag.toLowerCase());
    if (has) removeTag(tag);
    else addTag(tag);
  }

  const customerId = selected?.customer?.id || selected?.customer_id || null;
  const leadId = selected?.lead?.id || selected?.lead_id || null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-1">
      <CardPanel title="Customer" className="shrink-0">
        {selected ? (
          <>
            <dl className="space-y-2 text-sm">
              {[
                ["Name", selected.customer?.name || selected.visitor_name || "—"],
                ["Company", selected.customer?.company || selected.visitor_company || "—"],
                ["Phone", formatDisplayPhone(selected.customer?.phone || selected.visitor_phone) || "—"],
                ["Email", selected.customer?.email || selected.visitor_email || "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!customerId}
                onClick={() => {
                  if (!customerId) return;
                  void navigate({ to: "/customers", search: { id: customerId } });
                }}
              >
                Open customer
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!leadId}
                onClick={() => {
                  if (!leadId) return;
                  void navigate({ to: "/leads", search: { id: leadId } });
                }}
              >
                Open lead
              </Button>
            </div>
            {!customerId && !leadId ? (
              <p className="mt-2 text-[11px] text-muted-foreground">No linked customer or lead yet.</p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Select a conversation to see profile.</p>
        )}
      </CardPanel>

      <CardPanel title="This chat" className="shrink-0">
        {selected ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Assigned</p>
              <Select
                value={assignValue}
                disabled={assignMutation.isPending || staffQuery.isLoading}
                onValueChange={(value) => {
                  if (value === "__queue__") return;
                  assignMutation.mutate(value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Assign" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AI_ASSIGN}>EnerBot (AI)</SelectItem>
                  {assignValue === "__queue__" ? (
                    <SelectItem value="__queue__">Unassigned</SelectItem>
                  ) : null}
                  {selected?.assignee_id && !staff.some((p) => p.id === selected.assignee_id) ? (
                    <SelectItem value={selected.assignee_id}>
                      {selected.assignee_label || "Assigned"}
                    </SelectItem>
                  ) : null}
                  {staff.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                      {person.id === profileId ? " (me)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Picking a person pauses AI on this thread. EnerBot resumes when you choose it here or Return to AI.
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Labels</p>
              <div className="flex flex-wrap gap-1.5">
                {INBOX_LABEL_PRESETS.map((preset) => {
                  const on = tags.some((t) => t.toLowerCase() === preset.toLowerCase());
                  return (
                    <button
                      key={preset}
                      type="button"
                      disabled={tagsMutation.isPending}
                      onClick={() => togglePreset(preset)}
                      className="rounded-full"
                    >
                      <Pill tone={on ? "success" : "neutral"}>{preset}</Pill>
                    </button>
                  );
                })}
              </div>
              {tags.filter((t) => !INBOX_LABEL_PRESETS.some((p) => p.toLowerCase() === t.toLowerCase())).length >
              0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {tags
                    .filter((t) => !INBOX_LABEL_PRESETS.some((p) => p.toLowerCase() === t.toLowerCase()))
                    .map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="inline-flex items-center gap-1"
                        disabled={tagsMutation.isPending}
                        onClick={() => removeTag(tag)}
                      >
                        <Pill tone="neutral">
                          {tag}
                          <X className="ml-1 inline size-3 opacity-70" />
                        </Pill>
                      </button>
                    ))}
                </div>
              ) : null}
              <Input
                className="h-8 text-sm"
                placeholder="Type a label and press Enter"
                value={tagDraft}
                disabled={tagsMutation.isPending}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(tagDraft);
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Select a conversation.</p>
        )}
      </CardPanel>

      <CardPanel title="Internal note" className="shrink-0">
        {selected ? (
          <div className="space-y-2">
            <Textarea
              rows={3}
              className="text-sm"
              placeholder="Private to staff — not sent to the customer."
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              disabled={noteMutation.isPending}
            />
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={noteMutation.isPending || noteDraft.trim() === savedNote.trim()}
              onClick={() => noteMutation.mutate()}
            >
              {noteMutation.isPending ? "Saving…" : "Save note"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Select a conversation.</p>
        )}
      </CardPanel>

      <CardPanel title="Lead" className="shrink-0">
        {selected?.lead ? (
          <div className="space-y-3">
            {selected.lead.product_label ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Interest: </span>
                {selected.lead.product_label}
              </p>
            ) : null}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Status</p>
              <Select value={leadStatus} onValueChange={(value: LeadStatus) => onLeadStatusChange(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {leadStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Priority</p>
              <Select value={leadPriority} onValueChange={(value: PriorityLevel) => onLeadPriorityChange(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  {leadPriorities.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {priority}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" className="w-full" onClick={onUpdateLead} disabled={updatingLead}>
              {updatingLead ? "Saving…" : "Update lead from inbox"}
            </Button>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={pushFollowUpToBrainmine}
                onCheckedChange={(v) => onPushFollowUpChange(v === true)}
                className="mt-0.5"
              />
              <span>Also push follow-up to Brainmine (uses the summary below)</span>
            </label>
          </div>
        ) : selected ? (
          <p className="text-sm text-muted-foreground">This conversation does not have a linked lead yet.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Select a conversation.</p>
        )}
      </CardPanel>

      <CardPanel title="Conversation Summary" className="shrink-0">
        {selected ? (
          <div className="space-y-2">
            <Textarea
              rows={4}
              className="text-sm"
              value={summaryDraft}
              onChange={(e) => onSummaryDraftChange(e.target.value)}
              placeholder="Edit this brief yourself, or click Generate summary. Keep to 2–3 lines."
              disabled={generatingSummary || savingSummary}
            />
            <p className="text-[11px] text-muted-foreground">
              You can correct the AI text. Update lead and Brainmine use what you save here.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                disabled={generatingSummary || savingSummary}
                onClick={onGenerateSummary}
              >
                {generatingSummary ? "Generating…" : "Generate summary"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={
                  generatingSummary ||
                  savingSummary ||
                  !summaryDraft.trim() ||
                  summaryDraft.trim() === inboxAiSummary(selected)
                }
                onClick={onSaveSummary}
              >
                {savingSummary ? "Saving…" : "Save edits"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Select a conversation to see summary.</p>
        )}
      </CardPanel>
    </div>
  );
}
