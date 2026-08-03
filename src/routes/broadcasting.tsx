import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Megaphone, Pencil, Plus, RefreshCw, Send, Upload } from "lucide-react";
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
  createAndSendBroadcast,
  createAndSendEmailBroadcast,
  listBroadcastRecipients,
  listBroadcasts,
  listWaTemplates,
  submitWhatsAppTemplateToMeta,
  syncWhatsAppTemplatesFromMeta,
  type AudienceKind,
  type DbBroadcast,
  type DbWaTemplate,
  type WaTemplateStatus,
  analyzeWaTemplateFromRow,
} from "@/lib/broadcasting-api";
import { getGmailSetupInfo, sendGmailCompose } from "@/server/gmail-api";
import { SendEmailDialog } from "@/components/email/SendEmailDialog";
import { EMAIL_MERGE_TOKEN_HELP } from "@/lib/email-merge";
import {
  WA_CRM_FIELD_OPTIONS,
  defaultBindingsForLabels,
  type WaParamBinding,
} from "@/lib/wa-template-merge";
import {
  BROADCAST_LEAD_FILTER_FIELDS,
  audienceSupportsLeadFilters,
  type BroadcastLeadFilter,
  type BroadcastLeadFilterField,
} from "@/lib/broadcast-audience-filters";
import type { LeadStatus } from "@/lib/db-types";
import {
  downloadEmailAudienceTemplate,
  MAX_EMAIL_AUDIENCE_ROWS,
  parseEmailAudienceCsv,
  type EmailAudienceRecipient,
} from "@/lib/email-audience-import";

const LEAD_STATUS_FILTER_OPTIONS: LeadStatus[] = [
  "New",
  "Contacted",
  "Qualified",
  "Proposal",
  "Negotiation",
  "Won",
  "Lost",
];

export const Route = createFileRoute("/broadcasting")({
  head: () => ({
    meta: [
      { title: "Broadcasting — EnerTech Engage" },
      {
        name: "description",
        content: "WhatsApp template and Gmail email campaigns.",
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
  const [emailBroadcastOpen, setEmailBroadcastOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedBroadcast, setSelectedBroadcast] = useState<DbBroadcast | null>(null);
  const [viewTemplate, setViewTemplate] = useState<DbWaTemplate | null>(null);

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
  const [bcLeadFilters, setBcLeadFilters] = useState<BroadcastLeadFilter[]>([]);
  const [bcBindings, setBcBindings] = useState<WaParamBinding[]>([]);
  const [bcHeaderMediaUrl, setBcHeaderMediaUrl] = useState("");
  const [bcHeaderTextParams, setBcHeaderTextParams] = useState<string[]>([]);

  // Email broadcast form
  const [emName, setEmName] = useState("");
  const [emSubject, setEmSubject] = useState("");
  const [emBody, setEmBody] = useState(
    "Hello {{name}},\n\nThank you for your interest in {{requirement}}.\n{{sales_person}} from EnerTech will follow up with you.\n\nRegards,\nEnerTech",
  );
  const [emFormat, setEmFormat] = useState<"text" | "html">("text");
  const [emAudience, setEmAudience] = useState<AudienceKind>("leads_with_email");
  const [emManual, setEmManual] = useState("");
  const [emUploadRecipients, setEmUploadRecipients] = useState<EmailAudienceRecipient[]>([]);
  const [emUploadFileName, setEmUploadFileName] = useState<string | null>(null);
  const [emUploadSummary, setEmUploadSummary] = useState<string | null>(null);
  const emUploadInputRef = useRef<HTMLInputElement>(null);
  const [emDelayMin, setEmDelayMin] = useState("4");
  const [emDelayMax, setEmDelayMax] = useState("12");
  const [composeSending, setComposeSending] = useState(false);

  const templatesQuery = useQuery({
    queryKey: ["wa-templates", orgId],
    queryFn: () => listWaTemplates(orgId),
  });
  const broadcastsQuery = useQuery({
    queryKey: ["broadcasts", orgId],
    queryFn: () => listBroadcasts(orgId),
  });

  const gmailSetupQuery = useQuery({
    queryKey: ["gmail-setup"],
    queryFn: () => getGmailSetupInfo(),
  });

  const templates = templatesQuery.data ?? [];
  const broadcasts = broadcastsQuery.data ?? [];
  const emailBroadcasts = useMemo(
    () => broadcasts.filter((b) => b.channel_type === "email"),
    [broadcasts],
  );
  const waBroadcasts = useMemo(
    () => broadcasts.filter((b) => b.channel_type !== "email"),
    [broadcasts],
  );
  const approved = useMemo(
    () => templates.filter((t) => t.status === "APPROVED"),
    [templates],
  );

  const selectedTpl = templates.find((t) => t.id === bcTemplateId) || null;
  const selectedSpec = selectedTpl ? analyzeWaTemplateFromRow(selectedTpl) : null;
  const varCount = selectedSpec?.bodyVarCount ?? 0;

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
        bodyParamBindings: bcBindings.slice(0, varCount),
        audienceKind: bcAudience,
        manualPhones: bcManual.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
        leadFilters: bcLeadFilters,
        headerMediaUrl: bcHeaderMediaUrl.trim() || null,
        headerTextParams: bcHeaderTextParams,
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

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      if (!emName.trim()) throw new Error("Campaign name is required");
      if (!emSubject.trim()) throw new Error("Subject is required");
      if (!emBody.trim()) throw new Error("Body is required");
      if (!gmailSetupQuery.data?.connected) {
        throw new Error("Connect Gmail under Channels first");
      }
      if (emAudience === "upload_csv" && emUploadRecipients.length === 0) {
        throw new Error("Upload a CSV audience first (or download the template)");
      }
      const delayMinSec = Number(emDelayMin);
      const delayMaxSec = Number(emDelayMax);
      if (!Number.isFinite(delayMinSec) || delayMinSec < 0) {
        throw new Error("Min delay must be 0 or more seconds");
      }
      if (!Number.isFinite(delayMaxSec) || delayMaxSec < delayMinSec) {
        throw new Error("Max delay must be greater than or equal to min delay");
      }
      return createAndSendEmailBroadcast({
        orgId,
        name: emName,
        subject: emSubject,
        body: emBody,
        format: emFormat,
        audienceKind: emAudience,
        manualEmails: emManual.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
        uploadedRecipients:
          emAudience === "upload_csv"
            ? emUploadRecipients.map((r) => ({
                email: r.email,
                name: r.name,
                mergeFields: r.mergeFields,
              }))
            : undefined,
        createdBy: profile?.id,
        delayMinSec,
        delayMaxSec,
      });
    },
    onSuccess: async (r) => {
      await invalidate();
      setEmailBroadcastOpen(false);
      if (r.done === false || (typeof r.pending === "number" && r.pending > 0)) {
        toast.success(
          `Campaign sending… ${r.sent ?? 0} sent so far, ${r.pending ?? "?"} still queued. Rest continue via cron — refresh in a minute.`,
        );
      } else {
        toast.success(
          `Email campaign finished · sent ${r.sent}, failed ${r.failed} (delay ${r.delayMinSec ?? "—"}–${r.delayMaxSec ?? "—"}s)`,
        );
      }
      setTab("campaigns");
      setChannel("email");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Email campaign failed"),
  });

  const onEmailAudienceFile = (file: File | null) => {
    if (!file) {
      setEmUploadRecipients([]);
      setEmUploadFileName(null);
      setEmUploadSummary(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      toast.error("Please choose a .csv file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseEmailAudienceCsv(String(reader.result ?? ""));
        setEmUploadFileName(file.name);
        setEmUploadRecipients(parsed.recipients);
        const parts = [
          `${parsed.recipients.length} ready`,
          parsed.skippedDuplicate ? `${parsed.skippedDuplicate} duplicate` : null,
          parsed.skippedInvalid ? `${parsed.skippedInvalid} invalid` : null,
        ].filter(Boolean);
        setEmUploadSummary(parts.join(" · "));
        if (parsed.recipients.length === 0) {
          toast.error("No valid emails in this CSV");
        } else {
          toast.success(`Audience loaded · ${parts.join(" · ")}`);
        }
        if (parsed.errors.length > 0) {
          toast.message(
            `Notes: ${parsed.errors.slice(0, 3).join("; ")}${parsed.errors.length > 3 ? "…" : ""}`,
          );
        }
      } catch (err) {
        setEmUploadRecipients([]);
        setEmUploadFileName(null);
        setEmUploadSummary(null);
        toast.error(err instanceof Error ? err.message : "Could not parse CSV");
      }
    };
    reader.onerror = () => toast.error("Could not read file");
    reader.readAsText(file);
  };

  function openBroadcast() {
    if (channel === "email") {
      setEmName("");
      setEmSubject("");
      setEmBody(
        "Hello {{name}},\n\nThank you for your interest in {{requirement}}.\n{{sales_person}} from EnerTech will follow up with you.\n\nRegards,\nEnerTech",
      );
      setEmSubject("Follow-up: {{requirement}}");
      setEmFormat("text");
      setEmAudience("leads_with_email");
      setEmManual("");
      setEmUploadRecipients([]);
      setEmUploadFileName(null);
      setEmUploadSummary(null);
      if (emUploadInputRef.current) emUploadInputRef.current.value = "";
      setEmDelayMin("4");
      setEmDelayMax("12");
      setEmailBroadcastOpen(true);
      return;
    }
    setBcName("");
    setBcTemplateId(approved[0]?.id || "");
    setBcAudience("leads_with_phone");
    setBcManual("");
    setBcLeadFilters([]);
    {
      const t = approved[0];
      const spec = t ? analyzeWaTemplateFromRow(t) : null;
      setBcBindings(defaultBindingsForLabels(spec?.bodyVarLabels || []));
      setBcHeaderTextParams(
        Array.from({ length: spec?.headerTextVarLabels.length ?? 0 }, () => ""),
      );
    }
    setBcHeaderMediaUrl("");
    setBroadcastOpen(true);
  }

  function onPickTemplate(id: string) {
    setBcTemplateId(id);
    const t = templates.find((x) => x.id === id);
    const spec = t ? analyzeWaTemplateFromRow(t) : null;
    setBcBindings(defaultBindingsForLabels(spec?.bodyVarLabels || []));
    setBcHeaderMediaUrl("");
    setBcHeaderTextParams(
      Array.from({ length: spec?.headerTextVarLabels.length ?? 0 }, () => ""),
    );
  }

  return (
    <>
      <PageHeader
        title="Broadcasting"
        description="WhatsApp templates and Gmail email campaigns (n8n-style connected account)."
        meta={
          <div className="flex flex-wrap gap-2">
            <Pill tone="neutral">Channel: {channel === "email" ? "Gmail" : "WhatsApp"}</Pill>
            {channel === "email" ? (
              <Pill tone={gmailSetupQuery.data?.connected ? "success" : "warning"} dot>
                {gmailSetupQuery.data?.connected
                  ? `Gmail · ${gmailSetupQuery.data.email}`
                  : "Gmail not connected"}
              </Pill>
            ) : (
              <Pill tone="success" dot>
                {approved.length} approved
              </Pill>
            )}
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
                <SelectItem value="email">Gmail</SelectItem>
              </SelectContent>
            </Select>
            {channel === "email" ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setComposeOpen(true)}>
                  Send one email
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={openBroadcast}
                  disabled={!gmailSetupQuery.data?.connected}
                >
                  <Send className="size-3.5" /> New email campaign
                </Button>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {channel === "email" ? (
            <>
              <StatCard
                label="Gmail"
                value={gmailSetupQuery.data?.connected ? "Connected" : "Off"}
                hint={gmailSetupQuery.data?.email || "Channels → Gmail"}
                icon={Megaphone}
              />
              <StatCard label="Email campaigns" value={String(emailBroadcasts.length)} hint="Gmail sends" />
              <StatCard label="All campaigns" value={String(broadcasts.length)} hint="WA + email" />
            </>
          ) : (
            <>
              <StatCard label="Templates" value={String(templates.length)} hint="synced / submitted" icon={Megaphone} />
              <StatCard label="Approved" value={String(approved.length)} hint="ready to send" />
              <StatCard label="Campaigns" value={String(waBroadcasts.length)} hint="WhatsApp broadcasts" />
            </>
          )}
        </div>

        <div className="flex gap-2 border-b border-border">
          {(
            channel === "email"
              ? ([["campaigns", "Email campaigns"]] as const)
              : ([
                  ["campaigns", "Campaigns"],
                  ["templates", "Message templates"],
                ] as const)
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

        {tab === "templates" && channel !== "email" ? (
          <Panel
            title="Message templates"
            description="Create templates and submit them to Meta for approval. Use Sync from Meta to pull templates approved elsewhere."
            bodyClassName="p-4"
          >
            {templatesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading templates…</p>
            ) : templates.length === 0 ? (
              <EmptyState
                title="No templates yet"
                description="Click Sync from Meta to pull approved templates, or create a new one and submit it for Meta approval. Requires WhatsApp Business Account ID in Channels."
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {templates.map((t) => (
                  <article
                    key={t.id}
                    className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-border/80 hover:bg-secondary/20"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
                            {t.name}
                          </h3>
                          <Pill tone="info">{String(t.category || "—").replace(/_/g, " ")}</Pill>
                          <Pill tone={statusTone(t.status)}>
                            {String(t.status).charAt(0) +
                              String(t.status).slice(1).toLowerCase().replace(/_/g, " ")}
                          </Pill>
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {t.language}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 shrink-0 gap-1.5 px-2 text-muted-foreground"
                        onClick={() => setViewTemplate(t)}
                      >
                        <Pencil className="size-3.5" />
                        View
                      </Button>
                    </div>

                    {t.header_text ? (
                      <p className="mt-3 text-xs font-medium text-foreground/80">{t.header_text}</p>
                    ) : null}

                    <p className="mt-3 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                      {t.body_text || "No body preview"}
                    </p>

                    {t.footer_text ? (
                      <p className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                        {t.footer_text}
                      </p>
                    ) : t.last_synced_at ? (
                      <p className="mt-4 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                        Synced {new Date(t.last_synced_at).toLocaleString()}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Panel title={channel === "email" ? "Gmail campaigns" : "Broadcast campaigns"} bodyClassName="p-0">
              {broadcastsQuery.isLoading ? (
                <p className="p-4 text-sm text-muted-foreground">Loading…</p>
              ) : (channel === "email" ? emailBroadcasts : waBroadcasts).length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title="No campaigns yet"
                    description={
                      channel === "email"
                        ? "Connect Gmail under Channels, then start a New email campaign (Text or HTML)."
                        : "Create an approved WhatsApp template (or Sync from Meta), then start a New broadcast."
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {(channel === "email" ? emailBroadcasts : waBroadcasts).map((b) => (
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
                            {b.channel_type === "email"
                              ? `${b.subject || "No subject"} · ${b.body_format || "text"} · ${b.total_count} recipients`
                              : `${b.template_name} · ${b.channel_type} · ${b.total_count} recipients`}
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
                  ? selectedBroadcast.channel_type === "email"
                    ? `${selectedBroadcast.subject || "Email"} · ${selectedBroadcast.body_format || "text"}`
                    : `Template ${selectedBroadcast.template_name} (${selectedBroadcast.template_language})`
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
                        <p className="truncate font-medium">
                          {r.name || (r as { email?: string }).email || r.phone}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(r as { email?: string }).email || r.phone}
                        </p>
                        {r.error ? (
                          <p className="whitespace-normal break-words text-[11px] text-destructive">
                            {r.error}
                          </p>
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
              New broadcast → pick channel WhatsApp → choose approved template → map variables to CRM columns → pick audience
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
                  {selectedSpec?.headerNeedsMedia
                    ? `Header: ${selectedSpec.headerFormat} (media URL required) — `
                    : selectedTpl.header_text
                      ? `${selectedTpl.header_text} — `
                      : ""}
                  {selectedTpl.body_text}
                </p>
              ) : null}
            </div>
            {selectedSpec?.headerNeedsMedia ? (
              <div className="space-y-2">
                <Label>
                  Header {String(selectedSpec.headerFormat).toLowerCase()} URL (required)
                </Label>
                <Input
                  value={bcHeaderMediaUrl}
                  onChange={(e) => setBcHeaderMediaUrl(e.target.value)}
                  placeholder="https://… public image/video/document URL"
                />
                <p className="text-[11px] text-muted-foreground">
                  Meta rejects sends without this (error #132012). URL must be publicly reachable.
                </p>
              </div>
            ) : null}
            {selectedSpec && selectedSpec.headerTextVarLabels.length > 0 ? (
              <div className="space-y-2">
                <Label>Header text variables</Label>
                {selectedSpec.headerTextVarLabels.map((label, i) => (
                  <Input
                    key={label}
                    placeholder={`{{${label}}}`}
                    value={bcHeaderTextParams[i] || ""}
                    onChange={(e) =>
                      setBcHeaderTextParams((prev) => {
                        const next = [...prev];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            ) : null}
            {varCount > 0 && selectedSpec ? (
              <div className="space-y-2">
                <Label>Template variables (per recipient)</Label>
                <p className="text-[11px] text-muted-foreground">
                  Map each {"{{variable}}"} to a CRM column. Values are filled per lead/customer — not the same for everyone.
                  Manual phone lists only have name if you typed it; prefer Leads/Customers audience for full fields.
                </p>
                {selectedSpec.bodyVarLabels.map((label, i) => {
                  const binding = bcBindings[i] || { source: "name" as const };
                  return (
                    <div key={label} className="space-y-1.5 rounded-md border border-border/60 p-2.5">
                      <p className="text-xs font-medium">
                        {"{{"}
                        {label}
                        {"}}"}
                      </p>
                      <Select
                        value={binding.source}
                        onValueChange={(v) =>
                          setBcBindings((prev) => {
                            const next = [...prev];
                            while (next.length <= i) next.push({ source: "name" });
                            next[i] = {
                              source: v as WaParamBinding["source"],
                              staticValue: v === "__static__" ? next[i]?.staticValue || "" : undefined,
                            };
                            return next;
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose column" />
                        </SelectTrigger>
                        <SelectContent>
                          {WA_CRM_FIELD_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {binding.source === "__static__" ? (
                        <Input
                          placeholder="Fixed text for all recipients"
                          value={binding.staticValue || ""}
                          onChange={(e) =>
                            setBcBindings((prev) => {
                              const next = [...prev];
                              while (next.length <= i) next.push({ source: "__static__" });
                              next[i] = { source: "__static__", staticValue: e.target.value };
                              return next;
                            })
                          }
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>Audience</Label>
              <Select
                value={bcAudience}
                onValueChange={(v: AudienceKind) => {
                  setBcAudience(v);
                  if (!audienceSupportsLeadFilters(v)) setBcLeadFilters([]);
                }}
              >
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
            {audienceSupportsLeadFilters(bcAudience) ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Lead filters (optional)</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() =>
                      setBcLeadFilters((prev) => [
                        ...prev,
                        { field: "sales_person", value: "" },
                      ])
                    }
                  >
                    Add filter
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  All filters apply together (AND). Example: Sales person = Ritesh and Status = Qualified.
                </p>
                {bcLeadFilters.map((filter, i) => (
                  <div key={i} className="grid gap-2 rounded-md border border-border/60 p-2 sm:grid-cols-[1fr_1fr_auto]">
                    <Select
                      value={filter.field}
                      onValueChange={(v) =>
                        setBcLeadFilters((prev) => {
                          const next = [...prev];
                          next[i] = { ...next[i], field: v as BroadcastLeadFilterField, value: "" };
                          return next;
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BROADCAST_LEAD_FILTER_FIELDS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {filter.field === "status" ? (
                      <Select
                        value={filter.value || undefined}
                        onValueChange={(v) =>
                          setBcLeadFilters((prev) => {
                            const next = [...prev];
                            next[i] = { ...next[i], value: v };
                            return next;
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Equals…" />
                        </SelectTrigger>
                        <SelectContent>
                          {LEAD_STATUS_FILTER_OPTIONS.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        placeholder={
                          filter.field === "sales_person"
                            ? "e.g. Ritesh"
                            : filter.field === "source"
                              ? "e.g. indiamart"
                              : "e.g. Pune"
                        }
                        value={filter.value}
                        onChange={(e) =>
                          setBcLeadFilters((prev) => {
                            const next = [...prev];
                            next[i] = { ...next[i], value: e.target.value };
                            return next;
                          })
                        }
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setBcLeadFilters((prev) => prev.filter((_, idx) => idx !== i))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
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

      <Dialog open={emailBroadcastOpen} onOpenChange={setEmailBroadcastOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Gmail campaign</DialogTitle>
            <DialogDescription>
              Send from your connected Gmail. Subject and body support per-recipient merge fields from Leads/Customers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Campaign name</Label>
              <Input value={emName} onChange={(e) => setEmName(e.target.value)} placeholder="March email follow-up" />
            </div>
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                value={emSubject}
                onChange={(e) => setEmSubject(e.target.value)}
                placeholder="Follow-up: {{requirement}}"
              />
            </div>
            <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <p className="text-xs font-medium text-foreground">Merge fields (filled per lead/customer)</p>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {EMAIL_MERGE_TOKEN_HELP.join(" · ")}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Leads/Customers and Upload CSV fill all merge fields. Manual email list only gets{" "}
                {"{{email}}"} (and name if known). Upload is campaign-only — not saved as leads.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Body format</Label>
              <Select value={emFormat} onValueChange={(v: "text" | "html") => setEmFormat(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="html">HTML</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{emFormat === "html" ? "HTML body" : "Text body"}</Label>
              <Textarea rows={8} value={emBody} onChange={(e) => setEmBody(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label>Audience</Label>
              <Select value={emAudience} onValueChange={(v: AudienceKind) => setEmAudience(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="leads_with_email">All leads with email</SelectItem>
                  <SelectItem value="customers_with_email">All customers with email</SelectItem>
                  <SelectItem value="indiamart_leads">IndiaMART leads (with email)</SelectItem>
                  <SelectItem value="manual_emails">Manual email list</SelectItem>
                  <SelectItem value="upload_csv">Upload CSV (campaign only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {emAudience === "manual_emails" ? (
              <div className="space-y-2">
                <Label>Emails (one per line)</Label>
                <Textarea
                  rows={4}
                  placeholder={"buyer@example.com\nsales@company.com"}
                  value={emManual}
                  onChange={(e) => setEmManual(e.target.value)}
                />
              </div>
            ) : null}
            {emAudience === "upload_csv" ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  Download the template, fill merge-field columns (email required), then upload. Max{" "}
                  {MAX_EMAIL_AUDIENCE_ROWS} rows. Used only for this campaign — not saved as leads.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={() => downloadEmailAudienceTemplate()}
                >
                  <Download className="size-4" />
                  Download CSV template
                </Button>
                <div className="space-y-2">
                  <Label htmlFor="em-audience-csv">Upload CSV</Label>
                  <input
                    ref={emUploadInputRef}
                    id="em-audience-csv"
                    type="file"
                    accept=".csv,text/csv"
                    className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
                    onChange={(e) => onEmailAudienceFile(e.target.files?.[0] ?? null)}
                  />
                  {emUploadFileName ? (
                    <p className="text-xs text-muted-foreground">
                      <Upload className="mr-1 inline size-3" />
                      {emUploadFileName}
                      {emUploadSummary ? ` · ${emUploadSummary}` : ""}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-3">
              <div>
                <p className="text-sm font-medium text-foreground">Send delay (Gmail pacing)</p>
                <p className="text-xs text-muted-foreground">
                  Wait a random time between each email so sends look natural and reduce Gmail rate limits.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="em-delay-min">Min seconds</Label>
                  <Input
                    id="em-delay-min"
                    type="number"
                    min={0}
                    max={120}
                    value={emDelayMin}
                    onChange={(e) => setEmDelayMin(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="em-delay-max">Max seconds</Label>
                  <Input
                    id="em-delay-max"
                    type="number"
                    min={0}
                    max={300}
                    value={emDelayMax}
                    onChange={(e) => setEmDelayMax(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Example: {emDelayMin || "4"}–{emDelayMax || "12"}s → each next email waits a random time in that range.
                Large lists may take several minutes — keep this tab open until finished.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailBroadcastOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={sendEmailMutation.isPending || !gmailSetupQuery.data?.connected}
              onClick={() => sendEmailMutation.mutate()}
            >
              {sendEmailMutation.isPending ? "Sending with delay…" : "Send email campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewTemplate)} onOpenChange={(open) => !open && setViewTemplate(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {viewTemplate?.name}
              {viewTemplate ? (
                <>
                  <Pill tone="info">{String(viewTemplate.category || "—")}</Pill>
                  <Pill tone={statusTone(viewTemplate.status)}>{viewTemplate.status}</Pill>
                  <span className="text-xs font-normal uppercase text-muted-foreground">
                    {viewTemplate.language}
                  </span>
                </>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              Meta-approved templates are managed in Meta Business Manager. Use Sync from Meta after changes there.
            </DialogDescription>
          </DialogHeader>
          {viewTemplate ? (
            <div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-4">
              {viewTemplate.header_text ? (
                <p className="text-sm font-medium">{viewTemplate.header_text}</p>
              ) : null}
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{viewTemplate.body_text}</p>
              {viewTemplate.footer_text ? (
                <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                  {viewTemplate.footer_text}
                </p>
              ) : null}
              {viewTemplate.rejection_reason ? (
                <p className="text-xs text-destructive">Rejected: {viewTemplate.rejection_reason}</p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewTemplate(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SendEmailDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        fromLabel={gmailSetupQuery.data?.email}
        sending={composeSending}
        onSend={async (payload) => {
          setComposeSending(true);
          try {
            await sendGmailCompose({ data: payload });
            toast.success("Email sent via Gmail");
            setComposeOpen(false);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Send failed");
          } finally {
            setComposeSending(false);
          }
        }}
      />
    </>
  );
}
