import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Plus, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, Panel, Pill, StatCard } from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import { ENERTECH_ORG_ID } from "@/lib/chat-api";
import {
  countTemplateVars,
  createAndSendBroadcast,
  listBroadcastRecipients,
  listBroadcasts,
  listWaTemplates,
  submitWhatsAppTemplateToMeta,
  syncWhatsAppTemplatesFromMeta,
  type AudienceKind,
  type DbBroadcast,
  type DbWaTemplate,
  type WaTemplateStatus,
} from "@/lib/broadcasting-api";

export const Route = createFileRoute("/broadcasting")({
  head: () => ({
    meta: [
      { title: "Broadcasting — EnerTech Engage" },
      {
        name: "description",
        content: "WhatsApp template broadcasts: sync Meta templates and send campaigns.",
      },
      { property: "og:title", content: "Broadcasting — EnerTech Engage" },
    ],
  }),
  component: Page,
});

function statusTone(status: WaTemplateStatus | string): "success" | "warning" | "danger" | "neutral" | "info" {
  const s = String(status).toUpperCase();
  if (s === "APPROVED" || s === "COMPLETED") return "success";
  if (s === "PENDING" || s === "SENDING" || s === "QUEUED") return "warning";
  if (s === "REJECTED" || s === "FAILED") return "danger";
  if (s === "PAUSED" || s === "DISABLED") return "neutral";
  return "info";
}

function Page() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id ?? ENERTECH_ORG_ID;
  const [tab, setTab] = useState<"campaigns" | "templates">("campaigns");
  const [channel, setChannel] = useState("whatsapp");

  const [createOpen, setCreateOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [selectedBroadcast, setSelectedBroadcast] = useState<DbBroadcast | null>(null);

  // Create template form
  const [tplName, setTplName] = useState("");
  const [tplLang, setTplLang] = useState("en");
  const [tplCategory, setTplCategory] = useState<"MARKETING" | "UTILITY" | "AUTHENTICATION">("MARKETING");
  const [tplHeader, setTplHeader] = useState("");
  const [tplBody, setTplBody] = useState(
    "Hello {{1}}, thank you for contacting EnerTech UPS. Our team will follow up shortly.",
  );
  const [tplFooter, setTplFooter] = useState("EnerTech UPS");
  const [tplExamples, setTplExamples] = useState("Customer");

  // Broadcast form
  const [bcName, setBcName] = useState("");
  const [bcTemplateId, setBcTemplateId] = useState("");
  const [bcAudience, setBcAudience] = useState<AudienceKind>("leads_with_phone");
  const [bcManual, setBcManual] = useState("");
  const [bcVars, setBcVars] = useState<string[]>([]);

  const templatesQuery = useQuery({
    queryKey: ["wa-templates", orgId],
    queryFn: () => listWaTemplates(orgId),
  });
  const broadcastsQuery = useQuery({
    queryKey: ["broadcasts", orgId],
    queryFn: () => listBroadcasts(orgId),
  });

  const templates = templatesQuery.data ?? [];
  const broadcasts = broadcastsQuery.data ?? [];
  const approved = useMemo(
    () => templates.filter((t) => t.status === "APPROVED"),
    [templates],
  );

  const selectedTpl = templates.find((t) => t.id === bcTemplateId) || null;
  const varCount = selectedTpl ? countTemplateVars(selectedTpl.body_text) : 0;

  const recipientsQuery = useQuery({
    queryKey: ["broadcast-recipients", selectedBroadcast?.id],
    enabled: Boolean(selectedBroadcast?.id),
    queryFn: () => listBroadcastRecipients(selectedBroadcast!.id),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["wa-templates", orgId] });
    await queryClient.invalidateQueries({ queryKey: ["broadcasts", orgId] });
  };

  const syncMutation = useMutation({
    mutationFn: () => syncWhatsAppTemplatesFromMeta(),
    onSuccess: async (r) => {
      await invalidate();
      toast.success(`Synced ${r.synced} template(s) from Meta`);
      setTab("templates");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Sync failed"),
  });

  const submitTplMutation = useMutation({
    mutationFn: () =>
      submitWhatsAppTemplateToMeta({
        data: {
          name: tplName.trim().toLowerCase().replace(/\s+/g, "_"),
          language: tplLang,
          category: tplCategory,
          bodyText: tplBody,
          headerText: tplHeader || undefined,
          footerText: tplFooter || undefined,
          bodyExamples: tplExamples
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: async () => {
      await invalidate();
      setCreateOpen(false);
      toast.success("Template submitted to Meta for approval");
      setTab("templates");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Submit failed"),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTpl) throw new Error("Select an approved template");
      if (!bcName.trim()) throw new Error("Campaign name is required");
      return createAndSendBroadcast({
        orgId,
        name: bcName,
        template: selectedTpl,
        variableValues: bcVars.slice(0, varCount),
        audienceKind: bcAudience,
        manualPhones: bcManual.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
        createdBy: profile?.id,
      });
    },
    onSuccess: async (r) => {
      await invalidate();
      setBroadcastOpen(false);
      toast.success(`Broadcast finished · sent ${r.sent}, failed ${r.failed}`);
      setTab("campaigns");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Broadcast failed"),
  });

  function openBroadcast() {
    setBcName("");
    setBcTemplateId(approved[0]?.id || "");
    setBcAudience("leads_with_phone");
    setBcManual("");
    setBcVars([]);
    setBroadcastOpen(true);
  }

  function onPickTemplate(id: string) {
    setBcTemplateId(id);
    const t = templates.find((x) => x.id === id);
    const n = t ? countTemplateVars(t.body_text) : 0;
    setBcVars(Array.from({ length: n }, () => ""));
  }

  return (
    <>
      <PageHeader
        title="Broadcasting"
        description="Send WhatsApp template campaigns. Create templates, submit to Meta for approval, or sync approved ones."
        meta={
          <div className="flex flex-wrap gap-2">
            <Pill tone="neutral">Channel: WhatsApp</Pill>
            <Pill tone="success" dot>
              {approved.length} approved
            </Pill>
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="h-8 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={syncMutation.isPending}
              onClick={() => syncMutation.mutate()}
            >
              <RefreshCw className={`size-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              Sync from Meta
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" /> New template
            </Button>
            <Button size="sm" className="gap-1.5" onClick={openBroadcast} disabled={!approved.length}>
              <Send className="size-3.5" /> New broadcast
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Templates" value={String(templates.length)} hint="synced / submitted" icon={Megaphone} />
          <StatCard label="Approved" value={String(approved.length)} hint="ready to send" />
          <StatCard label="Campaigns" value={String(broadcasts.length)} hint="recent broadcasts" />
        </div>

        <div className="flex gap-2 border-b border-border">
          {(
            [
              ["campaigns", "Campaigns"],
              ["templates", "Message templates"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "templates" ? (
          <Panel title="WhatsApp message templates" bodyClassName="p-0">
            {templatesQuery.isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading templates…</p>
            ) : templates.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No templates yet"
                  description="Click Sync from Meta to pull approved templates, or create a new one and submit it for Meta approval. Requires WhatsApp Business Account ID in Channels."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {["Name", "Language", "Category", "Status", "Body", "Synced"].map((h) => (
                        <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {templates.map((t) => (
                      <tr key={t.id} className="hover:bg-secondary/30">
                        <td className="px-4 py-3 font-medium">{t.name}</td>
                        <td className="px-4 py-3">{t.language}</td>
                        <td className="px-4 py-3">{t.category}</td>
                        <td className="px-4 py-3">
                          <Pill tone={statusTone(t.status)}>{t.status}</Pill>
                        </td>
                        <td className="max-w-[280px] truncate px-4 py-3 text-muted-foreground">
                          {t.body_text}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {t.last_synced_at
                            ? new Date(t.last_synced_at).toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Panel title="Broadcast campaigns" bodyClassName="p-0">
              {broadcastsQuery.isLoading ? (
                <p className="p-4 text-sm text-muted-foreground">Loading…</p>
              ) : broadcasts.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title="No campaigns yet"
                    description="Create an approved WhatsApp template (or Sync from Meta), then start a New broadcast."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {broadcasts.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-secondary/40 ${
                          selectedBroadcast?.id === b.id ? "bg-secondary/50" : ""
                        }`}
                        onClick={() => setSelectedBroadcast(b)}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{b.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {b.template_name} · {b.channel_type} · {b.total_count} recipients
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <Pill tone={statusTone(b.status)}>{b.status}</Pill>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {b.sent_count} sent · {b.failed_count} failed
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title={selectedBroadcast ? selectedBroadcast.name : "Campaign detail"}
              description={
                selectedBroadcast
                  ? `Template ${selectedBroadcast.template_name} (${selectedBroadcast.template_language})`
                  : "Select a campaign"
              }
            >
              {!selectedBroadcast ? (
                <EmptyState title="Select a campaign" description="View recipient delivery status." />
              ) : recipientsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading recipients…</p>
              ) : (
                <ul className="max-h-[420px] space-y-2 overflow-y-auto text-sm">
                  {(recipientsQuery.data || []).map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.name || r.phone}</p>
                        <p className="text-xs text-muted-foreground">{r.phone}</p>
                        {r.error ? (
                          <p className="truncate text-[11px] text-destructive">{r.error}</p>
                        ) : null}
                      </div>
                      <Pill tone={statusTone(r.status)}>{r.status}</Pill>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )}

        <Panel title="How templates work">
          <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
            <li>Configure WhatsApp under Channels (Phone Number ID, Access Token, <strong>Business Account ID</strong>).</li>
            <li>
              Use <strong>Sync from Meta</strong> to pull templates already approved in Meta Business Manager — best when
              you already have templates.
            </li>
            <li>
              Or create a template here and submit it. Meta reviews MARKETING/UTILITY templates (often minutes to days).
              Only <strong>APPROVED</strong> templates can be broadcast.
            </li>
            <li>
              New broadcast → pick channel WhatsApp → choose approved template → fill variables → pick audience
              (leads / customers / IndiaMART / manual phones) → send.
            </li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            Run migration <code className="rounded bg-secondary px-1">009_broadcasting.sql</code> in Supabase once.
          </p>
        </Panel>
      </div>

      {/* Create template */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create WhatsApp template</DialogTitle>
            <DialogDescription>
              Submitted to Meta for approval. Use lowercase_snake_case name. Variables use {"{{1}}"}, {"{{2}}"}, …
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="enertech_followup"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={tplLang} onValueChange={setTplLang}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">en</SelectItem>
                    <SelectItem value="en_US">en_US</SelectItem>
                    <SelectItem value="hi">hi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={tplCategory}
                  onValueChange={(v: typeof tplCategory) => setTplCategory(v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">MARKETING</SelectItem>
                    <SelectItem value="UTILITY">UTILITY</SelectItem>
                    <SelectItem value="AUTHENTICATION">AUTHENTICATION</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Header (optional)</Label>
              <Input value={tplHeader} onChange={(e) => setTplHeader(e.target.value)} maxLength={60} />
            </div>
            <div className="space-y-2">
              <Label>Body</Label>
              <Textarea rows={4} value={tplBody} onChange={(e) => setTplBody(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Body examples (comma-separated for {"{{1}}"}, {"{{2}}"}…)</Label>
              <Input value={tplExamples} onChange={(e) => setTplExamples(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Footer (optional)</Label>
              <Input value={tplFooter} onChange={(e) => setTplFooter(e.target.value)} maxLength={60} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={submitTplMutation.isPending} onClick={() => submitTplMutation.mutate()}>
              {submitTplMutation.isPending ? "Submitting…" : "Submit to Meta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New broadcast */}
      <Dialog open={broadcastOpen} onOpenChange={setBroadcastOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New WhatsApp broadcast</DialogTitle>
            <DialogDescription>
              Choose an APPROVED template and audience. Sends immediately via Meta Cloud API.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Campaign name</Label>
              <Input value={bcName} onChange={(e) => setBcName(e.target.value)} placeholder="March follow-up" />
            </div>
            <div className="space-y-2">
              <Label>Channel</Label>
              <Input value="WhatsApp" disabled />
            </div>
            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={bcTemplateId} onValueChange={onPickTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Select approved template" />
                </SelectTrigger>
                <SelectContent>
                  {approved.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.language})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTpl ? (
                <p className="rounded-md bg-secondary p-2 text-xs text-muted-foreground">
                  {selectedTpl.header_text ? `${selectedTpl.header_text} — ` : ""}
                  {selectedTpl.body_text}
                </p>
              ) : null}
            </div>
            {varCount > 0 ? (
              <div className="space-y-2">
                <Label>Template variables (same for all recipients)</Label>
                {Array.from({ length: varCount }, (_, i) => (
                  <Input
                    key={i}
                    placeholder={`{{${i + 1}}}`}
                    value={bcVars[i] || ""}
                    onChange={(e) =>
                      setBcVars((prev) => {
                        const next = [...prev];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>Audience</Label>
              <Select value={bcAudience} onValueChange={(v: AudienceKind) => setBcAudience(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="leads_with_phone">All leads with phone</SelectItem>
                  <SelectItem value="customers_with_phone">All customers with phone</SelectItem>
                  <SelectItem value="indiamart_leads">IndiaMART leads</SelectItem>
                  <SelectItem value="manual">Manual phone list</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {bcAudience === "manual" ? (
              <div className="space-y-2">
                <Label>Phones (one per line, with country code)</Label>
                <Textarea
                  rows={4}
                  placeholder={"9198xxxxxxxx\n9188xxxxxxxx"}
                  value={bcManual}
                  onChange={(e) => setBcManual(e.target.value)}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBroadcastOpen(false)}>
              Cancel
            </Button>
            <Button disabled={sendMutation.isPending || !approved.length} onClick={() => sendMutation.mutate()}>
              {sendMutation.isPending ? "Sending…" : "Send broadcast"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
