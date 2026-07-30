import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Pencil, RefreshCw } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  ChannelIcon,
  EmptyState,
  PageHeader,
  Panel,
  Pill,
  ScoreBar,
  StatCard,
} from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import { ENERTECH_ORG_ID } from "@/lib/chat-api";
import {
  channelStatusTone,
  isLiveChannel,
  listChannelsWithStats,
  setChannelEnabled,
  updateChannel,
  type ChannelWithStats,
} from "@/lib/channels-api";
import { getWhatsAppSetupInfo, saveWhatsAppChannelConfig } from "@/server/whatsapp";
import { getEmailSetupInfo, saveEmailChannelConfig } from "@/server/email";
import { getMetaSetupInfo, saveMetaChannelConfig } from "@/server/meta-messenger";
import {
  ensureIndiaMartChannel,
  getIndiaMartSetupInfo,
  saveIndiaMartChannelConfig,
  syncIndiaMartLeads,
} from "@/server/indiamart";
import type { ChannelStatus } from "@/lib/db-types";

const statusOptions: ChannelStatus[] = ["Connected", "Degraded", "Disconnected", "Action Required"];

export const Route = createFileRoute("/channels")({
  head: () => ({
    meta: [
      { title: "Channels — EnerTech Engage" },
      { name: "description", content: "Connection manager and health monitoring for every customer touchpoint." },
      { property: "og:title", content: "Channels — EnerTech Engage" },
    ],
  }),
  component: Page,
});

function Page() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id ?? ENERTECH_ORG_ID;
  const appUrl =
    (typeof window !== "undefined"
      ? (import.meta.env.VITE_APP_URL as string) || window.location.origin
      : (import.meta.env.VITE_APP_URL as string) || "") || "";
  const widgetKey = (import.meta.env.VITE_WIDGET_PUBLIC_KEY as string) || "";

  const [copied, setCopied] = useState(false);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [editing, setEditing] = useState<ChannelWithStats | null>(null);
  const [formName, setFormName] = useState("");
  const [formDetail, setFormDetail] = useState("");
  const [formStatus, setFormStatus] = useState<ChannelStatus>("Disconnected");
  const [formHealth, setFormHealth] = useState("100");
  const [waPhoneNumberId, setWaPhoneNumberId] = useState("");
  const [waAccessToken, setWaAccessToken] = useState("");
  const [waVerifyToken, setWaVerifyToken] = useState("");
  const [waBusinessAccountId, setWaBusinessAccountId] = useState("");
  const [waDisplayPhone, setWaDisplayPhone] = useState("");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailFromName, setEmailFromName] = useState("EnerTech Engage");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [emailInboundSecret, setEmailInboundSecret] = useState("");
  const [emailWebhookCopied, setEmailWebhookCopied] = useState(false);
  const [metaPageId, setMetaPageId] = useState("");
  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [metaVerifyToken, setMetaVerifyToken] = useState("");
  const [metaPageName, setMetaPageName] = useState("");
  const [metaIgAccountId, setMetaIgAccountId] = useState("");
  const [fbWebhookCopied, setFbWebhookCopied] = useState(false);
  const [igWebhookCopied, setIgWebhookCopied] = useState(false);
  const [imCrmKey, setImCrmKey] = useState("");
  const [imPushSecret, setImPushSecret] = useState("");
  const [imWebhookCopied, setImWebhookCopied] = useState(false);

  const channelsQuery = useQuery({
    queryKey: ["channels", orgId],
    queryFn: () => listChannelsWithStats(orgId),
  });

  const waSetupQuery = useQuery({
    queryKey: ["whatsapp-setup"],
    queryFn: () => getWhatsAppSetupInfo(),
  });

  const emailSetupQuery = useQuery({
    queryKey: ["email-setup"],
    queryFn: () => getEmailSetupInfo(),
  });

  const fbSetupQuery = useQuery({
    queryKey: ["meta-setup", "facebook"],
    queryFn: () => getMetaSetupInfo({ data: { type: "facebook" } }),
  });

  const igSetupQuery = useQuery({
    queryKey: ["meta-setup", "instagram"],
    queryFn: () => getMetaSetupInfo({ data: { type: "instagram" } }),
  });

  const imSetupQuery = useQuery({
    queryKey: ["indiamart-setup"],
    queryFn: () => getIndiaMartSetupInfo(),
  });

  const channels = channelsQuery.data ?? [];
  const connected = channels.filter((c) => c.status === "Connected").length;
  const enabled = channels.filter((c) => c.is_enabled).length;
  const openThreads = channels.reduce((sum, c) => sum + c.openCount, 0);
  const website = channels.find((c) => c.type === "website");
  const whatsapp = channels.find((c) => c.type === "whatsapp");
  const emailChannel = channels.find((c) => c.type === "email");
  const facebook = channels.find((c) => c.type === "facebook");
  const instagram = channels.find((c) => c.type === "instagram");
  const indiamart = channels.find((c) => c.type === "indiamart");
  const webhookUrl =
    waSetupQuery.data?.webhookUrl ||
    `${String(appUrl).replace(/\/$/, "")}/api/webhooks/whatsapp`;
  const emailWebhookUrl =
    emailSetupQuery.data?.webhookUrl ||
    `${String(appUrl).replace(/\/$/, "")}/api/webhooks/email`;
  const fbWebhookUrl =
    fbSetupQuery.data?.webhookUrl ||
    `${String(appUrl).replace(/\/$/, "")}/api/webhooks/facebook`;
  const igWebhookUrl =
    igSetupQuery.data?.webhookUrl ||
    `${String(appUrl).replace(/\/$/, "")}/api/webhooks/instagram`;
  const imWebhookUrl =
    imSetupQuery.data?.webhookUrl ||
    `${String(appUrl).replace(/\/$/, "")}/api/webhooks/indiamart`;

  const snippet = useMemo(() => {
    return `<script
  src="${appUrl}/widget.js"
  data-app-url="${appUrl}"
  data-key="${widgetKey || "YOUR_WIDGET_PUBLIC_KEY"}"
  async>
</script>`;
  }, [appUrl, widgetKey]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["channels", orgId] }),
      queryClient.invalidateQueries({ queryKey: ["whatsapp-setup"] }),
      queryClient.invalidateQueries({ queryKey: ["email-setup"] }),
      queryClient.invalidateQueries({ queryKey: ["meta-setup"] }),
      queryClient.invalidateQueries({ queryKey: ["indiamart-setup"] }),
    ]);
  };

  const toggleMutation = useMutation({
    mutationFn: async ({ channel, enabled }: { channel: ChannelWithStats; enabled: boolean }) => {
      if (channel.type === "whatsapp" && enabled && !waSetupQuery.data?.configured) {
        throw new Error("Configure Meta WhatsApp credentials first (Configure on the WhatsApp card).");
      }
      if (channel.type === "email" && enabled && !emailSetupQuery.data?.configured) {
        throw new Error("Configure SMTP email credentials first (Configure on the Email card).");
      }
      if (channel.type === "facebook" && enabled && !fbSetupQuery.data?.configured) {
        throw new Error("Configure Facebook Messenger credentials first.");
      }
      if (channel.type === "instagram" && enabled && !igSetupQuery.data?.configured) {
        throw new Error("Configure Instagram Messaging credentials first.");
      }
      if (channel.type === "indiamart" && enabled && !imSetupQuery.data?.configured) {
        throw new Error("Configure IndiaMART CRM key first (Configure on the IndiaMART card).");
      }
      return setChannelEnabled({
        channelId: channel.id,
        enabled,
        type: channel.type,
      });
    },
    onSuccess: async (_data, vars) => {
      await invalidate();
      if (vars.enabled && !isLiveChannel(vars.channel.type)) {
        toast.message(`${vars.channel.name} marked enabled`, {
          description: "Provider API credentials are not connected yet — status is Action Required.",
        });
      } else {
        toast.success(
          vars.enabled ? `${vars.channel.name} enabled` : `${vars.channel.name} disabled`,
        );
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update channel"),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("No channel selected");

      if (editing.type === "whatsapp") {
        if (!waPhoneNumberId.trim() || !waVerifyToken.trim()) {
          throw new Error("Phone Number ID and Verify Token are required");
        }
        const existingToken = (editing.config as { access_token?: string } | null)?.access_token;
        const token = waAccessToken.trim() || existingToken || "";
        if (!token) throw new Error("Access Token is required");
        return saveWhatsAppChannelConfig({
          data: {
            phoneNumberId: waPhoneNumberId,
            accessToken: token,
            verifyToken: waVerifyToken,
            businessAccountId: waBusinessAccountId || undefined,
            displayPhone: waDisplayPhone || undefined,
            enable: true,
          },
        });
      }

      if (editing.type === "email") {
        const existingPass = (editing.config as { smtp_pass?: string } | null)?.smtp_pass;
        const pass = smtpPass.trim() || existingPass || "";
        if (!emailFrom.trim() || !smtpHost.trim() || !smtpUser.trim() || !pass) {
          throw new Error("From email, SMTP host, user, and password are required");
        }
        const port = Number(smtpPort);
        if (!Number.isFinite(port)) throw new Error("SMTP port must be a number");
        return saveEmailChannelConfig({
          data: {
            fromEmail: emailFrom,
            fromName: emailFromName || undefined,
            smtpHost,
            smtpPort: port,
            smtpSecure,
            smtpUser,
            smtpPass: pass,
            inboundSecret: emailInboundSecret || undefined,
            enable: true,
          },
        });
      }

      if (editing.type === "facebook" || editing.type === "instagram") {
        const existingToken = (editing.config as { access_token?: string } | null)?.access_token;
        const token = metaAccessToken.trim() || existingToken || "";
        if (!metaPageId.trim() || !metaVerifyToken.trim() || !token) {
          throw new Error("Page ID, Access Token, and Verify Token are required");
        }
        return saveMetaChannelConfig({
          data: {
            type: editing.type,
            pageId: metaPageId,
            accessToken: token,
            verifyToken: metaVerifyToken,
            pageName: metaPageName || undefined,
            igAccountId: editing.type === "instagram" ? metaIgAccountId || undefined : undefined,
            enable: true,
          },
        });
      }

      if (editing.type === "indiamart") {
        const existingKey = (editing.config as { crm_key?: string } | null)?.crm_key;
        const key = imCrmKey.trim() || existingKey || "";
        if (!key) throw new Error("IndiaMART CRM key (glusr_crm_key) is required");
        return saveIndiaMartChannelConfig({
          data: {
            crmKey: key,
            pushSecret: imPushSecret || undefined,
            enable: true,
          },
        });
      }

      const health = Number(formHealth);
      if (!Number.isFinite(health) || health < 0 || health > 100) {
        throw new Error("Health must be 0–100");
      }
      if (!formName.trim()) throw new Error("Name is required");
      return updateChannel({
        channelId: editing.id,
        name: formName,
        detail: formDetail,
        status: formStatus,
        health,
        is_enabled: formStatus === "Connected" || formStatus === "Degraded" || formStatus === "Action Required",
      });
    },
    onSuccess: async (result) => {
      await invalidate();
      setEditing(null);
      if (result && typeof result === "object" && "smtpOk" in result && result.smtpOk === false) {
        toast.message("Email saved", {
          description: `SMTP verify warning: ${String((result as { smtpError?: string }).smtpError || "check credentials")}`,
        });
      } else {
        toast.success("Channel updated");
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Save failed"),
  });

  function openEdit(channel: ChannelWithStats) {
    setEditing(channel);
    setFormName(channel.name);
    setFormDetail(channel.detail || "");
    setFormStatus(channel.status);
    setFormHealth(String(channel.health ?? 0));
    if (channel.type === "whatsapp") {
      const cfg = (channel.config || {}) as {
        phone_number_id?: string;
        access_token?: string;
        verify_token?: string;
        business_account_id?: string;
        display_phone?: string;
      };
      setWaPhoneNumberId(cfg.phone_number_id || "");
      setWaAccessToken("");
      setWaVerifyToken(cfg.verify_token || "");
      setWaBusinessAccountId(cfg.business_account_id || "");
      setWaDisplayPhone(cfg.display_phone || channel.detail || "");
    }
    if (channel.type === "email") {
      const cfg = (channel.config || {}) as {
        from_email?: string;
        from_name?: string;
        smtp_host?: string;
        smtp_port?: number;
        smtp_secure?: boolean;
        smtp_user?: string;
        smtp_pass?: string;
        inbound_secret?: string;
      };
      setEmailFrom(cfg.from_email || channel.detail || "");
      setEmailFromName(cfg.from_name || "EnerTech Engage");
      setSmtpHost(cfg.smtp_host || "");
      setSmtpPort(String(cfg.smtp_port || 587));
      setSmtpSecure(Boolean(cfg.smtp_secure));
      setSmtpUser(cfg.smtp_user || "");
      setSmtpPass("");
      setEmailInboundSecret(cfg.inbound_secret || "");
    }
    if (channel.type === "facebook" || channel.type === "instagram") {
      const cfg = (channel.config || {}) as {
        page_id?: string;
        access_token?: string;
        verify_token?: string;
        page_name?: string;
        ig_account_id?: string;
      };
      setMetaPageId(cfg.page_id || "");
      setMetaAccessToken("");
      setMetaVerifyToken(cfg.verify_token || "");
      setMetaPageName(cfg.page_name || channel.detail || "");
      setMetaIgAccountId(cfg.ig_account_id || "");
    }
    if (channel.type === "indiamart") {
      const cfg = (channel.config || {}) as { crm_key?: string; push_secret?: string };
      setImCrmKey("");
      setImPushSecret(cfg.push_secret || "");
    }
  }

  const syncImMutation = useMutation({
    mutationFn: () => syncIndiaMartLeads({ data: { days: 1 } }),
    onSuccess: async (result) => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      toast.success(
        `IndiaMART sync: ${result.created} new · ${result.skipped} duplicates · ${result.fetched} fetched`,
      );
      if (result.errors.length) {
        toast.message("Some enquiries failed", { description: result.errors[0] });
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Sync failed"),
  });

  const ensureImMutation = useMutation({
    mutationFn: () => ensureIndiaMartChannel(),
    onSuccess: async (result) => {
      await invalidate();
      if (!result.ok) {
        toast.error(result.error || "Could not create IndiaMART channel");
        return;
      }
      toast.success(result.created ? "IndiaMART channel card created" : "IndiaMART channel already exists");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not create channel"),
  });

  // After setup query auto-seeds the row, refresh the cards grid
  useEffect(() => {
    if (imSetupQuery.data?.channelCreated || (imSetupQuery.data?.channelReady && !indiamart)) {
      void queryClient.invalidateQueries({ queryKey: ["channels", orgId] });
    }
  }, [
    imSetupQuery.data?.channelCreated,
    imSetupQuery.data?.channelReady,
    indiamart,
    orgId,
    queryClient,
  ]);

  return (
    <>
      <PageHeader
        title="Channels"
        description="Manage customer touchpoints including Meta channels and IndiaMART lead sync for follow-up."
        meta={
          <div className="flex flex-wrap gap-2">
            <Pill tone={website?.is_enabled ? "success" : "warning"} dot>
              {website?.is_enabled ? "Website live" : "Website off"}
            </Pill>
            <Pill tone={waSetupQuery.data?.configured && whatsapp?.is_enabled ? "success" : "warning"} dot>
              {waSetupQuery.data?.configured && whatsapp?.is_enabled ? "WhatsApp live" : "WhatsApp setup"}
            </Pill>
            <Pill tone={emailSetupQuery.data?.configured && emailChannel?.is_enabled ? "success" : "warning"} dot>
              {emailSetupQuery.data?.configured && emailChannel?.is_enabled ? "Email live" : "Email setup"}
            </Pill>
            <Pill tone={fbSetupQuery.data?.configured && facebook?.is_enabled ? "success" : "warning"} dot>
              {fbSetupQuery.data?.configured && facebook?.is_enabled ? "Facebook live" : "Facebook setup"}
            </Pill>
            <Pill tone={igSetupQuery.data?.configured && instagram?.is_enabled ? "success" : "warning"} dot>
              {igSetupQuery.data?.configured && instagram?.is_enabled ? "Instagram live" : "Instagram setup"}
            </Pill>
            <Pill tone={imSetupQuery.data?.configured && indiamart?.is_enabled ? "success" : "warning"} dot>
              {imSetupQuery.data?.configured && indiamart?.is_enabled ? "IndiaMART live" : "IndiaMART setup"}
            </Pill>
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={channelsQuery.isFetching}
              onClick={async () => {
                await invalidate();
                toast.success("Channels refreshed");
              }}
            >
              <RefreshCw className={`size-3.5 ${channelsQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/inbox">Open inbox</Link>
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Channels" value={String(channels.length)} hint="in this workspace" />
          <StatCard label="Connected" value={String(connected)} hint="ready to receive" />
          <StatCard label="Enabled" value={String(enabled)} hint="turned on in app" />
          <StatCard label="Open threads" value={String(openThreads)} hint="ai / human / escalated" />
        </div>

        <Panel title="Website chat — embed code" description="Paste this before </body> on any website">
          <p className="mb-3 text-sm text-muted-foreground">
            Visitors chat in an iframe bubble. Messages appear in Omnichannel Inbox. Demo:{" "}
            <a
              className="text-primary underline"
              href={
                widgetKey
                  ? `/widget-demo.html?key=${encodeURIComponent(widgetKey)}`
                  : "/widget-demo.html"
              }
              target="_blank"
              rel="noreferrer"
            >
              /widget-demo.html
            </a>
          </p>
          {!widgetKey ? (
            <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">
              Set <code className="rounded bg-secondary px-1">WIDGET_PUBLIC_KEY</code> and{" "}
              <code className="rounded bg-secondary px-1">VITE_WIDGET_PUBLIC_KEY</code> in{" "}
              <code className="rounded bg-secondary px-1">.env</code>, then restart the dev server.
            </p>
          ) : null}
          <pre className="overflow-x-auto rounded-lg border border-border bg-secondary/50 p-3 text-xs leading-relaxed">
            {snippet}
          </pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                await navigator.clipboard.writeText(snippet);
                setCopied(true);
                toast.success("Embed code copied");
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              <Copy className="size-3.5" /> {copied ? "Copied" : "Copy embed code"}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" asChild>
              <a href={`/embed?key=${encodeURIComponent(widgetKey)}`} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" /> Open embed preview
              </a>
            </Button>
          </div>
        </Panel>

        <Panel
          title="WhatsApp (Meta Cloud API)"
          description="Connect Meta WhatsApp so inbound chats appear in Inbox like Website chat."
        >
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Create a Meta app with WhatsApp product → copy Phone Number ID + permanent Access Token.</li>
            <li>
              Click <span className="font-medium text-foreground">Configure</span> on the WhatsApp channel card and paste credentials + a Verify Token you choose.
            </li>
            <li>
              In Meta webhook settings, set Callback URL to the URL below and use the same Verify Token. Subscribe to{" "}
              <code className="rounded bg-secondary px-1">messages</code>.
            </li>
            <li>
              For local testing, expose this app with a public HTTPS tunnel (ngrok / Cloudflare Tunnel) — Meta cannot call localhost.
            </li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full flex-1 truncate rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs">
              {webhookUrl}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={async () => {
                await navigator.clipboard.writeText(webhookUrl);
                setWebhookCopied(true);
                toast.success("Webhook URL copied");
                window.setTimeout(() => setWebhookCopied(false), 1500);
              }}
            >
              <Copy className="size-3.5" /> {webhookCopied ? "Copied" : "Copy webhook URL"}
            </Button>
            {whatsapp ? (
              <Button size="sm" onClick={() => openEdit(whatsapp)}>
                Configure WhatsApp
              </Button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Status:{" "}
            {waSetupQuery.data?.configured
              ? "Credentials saved — send a WhatsApp message to your business number; it should appear in Inbox (channel WhatsApp)."
              : "Not configured yet."}
          </p>
        </Panel>

        <Panel
          title="Email (SMTP + inbound webhook)"
          description="Connect SMTP for outbound replies. Forward inbound mail to the webhook so threads appear in Inbox."
        >
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Click <span className="font-medium text-foreground">Configure Email</span> and enter From address + SMTP host/user/password (Gmail app password, Office365, etc.).
            </li>
            <li>
              Point SendGrid Inbound Parse / Cloudflare Email Routing / a mail forwarder to the webhook URL below.
            </li>
            <li>
              Optional: set an inbound secret and send header{" "}
              <code className="rounded bg-secondary px-1">x-enertech-email-secret</code>.
            </li>
            <li>For local testing, use a public HTTPS tunnel — providers cannot POST to localhost.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full flex-1 truncate rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs">
              {emailWebhookUrl}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={async () => {
                await navigator.clipboard.writeText(emailWebhookUrl);
                setEmailWebhookCopied(true);
                toast.success("Email webhook URL copied");
                window.setTimeout(() => setEmailWebhookCopied(false), 1500);
              }}
            >
              <Copy className="size-3.5" /> {emailWebhookCopied ? "Copied" : "Copy webhook URL"}
            </Button>
            {emailChannel ? (
              <Button size="sm" onClick={() => openEdit(emailChannel)}>
                Configure Email
              </Button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Status:{" "}
            {emailSetupQuery.data?.configured
              ? `SMTP saved for ${emailSetupQuery.data.fromEmail}. Inbound mail → Inbox (channel Email).`
              : "Not configured yet."}
          </p>
        </Panel>

        <Panel
          title="Facebook Messenger"
          description="Connect a Facebook Page. Inbound DMs appear in Inbox; AI replies via Master + specialists."
        >
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Create a Meta app → add Messenger → generate a Page access token for your Page.</li>
            <li>Configure Facebook below with Page ID, token, and a Verify Token you choose.</li>
            <li>
              In Meta webhooks, set Callback URL to the URL below, same Verify Token, subscribe the Page to{" "}
              <code className="rounded bg-secondary px-1">messages</code>.
            </li>
            <li>Use a public HTTPS URL (ngrok) for local testing.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full flex-1 truncate rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs">
              {fbWebhookUrl}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={async () => {
                await navigator.clipboard.writeText(fbWebhookUrl);
                setFbWebhookCopied(true);
                toast.success("Facebook webhook URL copied");
                window.setTimeout(() => setFbWebhookCopied(false), 1500);
              }}
            >
              <Copy className="size-3.5" /> {fbWebhookCopied ? "Copied" : "Copy webhook URL"}
            </Button>
            {facebook ? (
              <Button size="sm" onClick={() => openEdit(facebook)}>
                Configure Facebook
              </Button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Status:{" "}
            {fbSetupQuery.data?.configured
              ? "Credentials saved — Messenger threads appear in Inbox (channel Facebook)."
              : "Not configured yet."}
          </p>
        </Panel>

        <Panel
          title="Instagram Messaging"
          description="Link an Instagram professional account to your Facebook Page, then configure Instagram here."
        >
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Connect IG professional account to the same Facebook Page in Meta Business Suite.</li>
            <li>Configure Instagram with Page ID + Page access token + Verify Token (can match Facebook).</li>
            <li>
              Webhook Callback URL below; subscribe to Instagram{" "}
              <code className="rounded bg-secondary px-1">messages</code>.
            </li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full flex-1 truncate rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs">
              {igWebhookUrl}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={async () => {
                await navigator.clipboard.writeText(igWebhookUrl);
                setIgWebhookCopied(true);
                toast.success("Instagram webhook URL copied");
                window.setTimeout(() => setIgWebhookCopied(false), 1500);
              }}
            >
              <Copy className="size-3.5" /> {igWebhookCopied ? "Copied" : "Copy webhook URL"}
            </Button>
            {instagram ? (
              <Button size="sm" onClick={() => openEdit(instagram)}>
                Configure Instagram
              </Button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Status:{" "}
            {igSetupQuery.data?.configured
              ? "Credentials saved — Instagram DMs appear in Inbox (channel Instagram)."
              : "Not configured yet."}
          </p>
        </Panel>

        <Panel
          title="IndiaMART (Lead Manager)"
          description="Pull enquiries / buy-leads into Leads + Inbox for remarketing and follow-up. Optional Push webhook for real-time."
        >
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Generate CRM key at{" "}
              <a
                className="text-primary underline"
                href="https://seller.indiamart.com/leadmanager/crmapi"
                target="_blank"
                rel="noreferrer"
              >
                seller.indiamart.com/leadmanager/crmapi
              </a>
              .
            </li>
            <li>Configure IndiaMART below with the CRM key (glusr_crm_key).</li>
            <li>
              Click <span className="font-medium text-foreground">Sync leads now</span> to pull the latest window
              (max 7 days). New enquiries become Leads (source IndiaMART) and Inbox threads tagged Remarketing.
            </li>
            <li>
              Optional: set Push webhook URL in IndiaMART Seller panel to the URL below for real-time leads.
            </li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full flex-1 truncate rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs">
              {imWebhookUrl}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={async () => {
                await navigator.clipboard.writeText(imWebhookUrl);
                setImWebhookCopied(true);
                toast.success("IndiaMART webhook URL copied");
                window.setTimeout(() => setImWebhookCopied(false), 1500);
              }}
            >
              <Copy className="size-3.5" /> {imWebhookCopied ? "Copied" : "Copy webhook URL"}
            </Button>
            {indiamart ? (
              <Button size="sm" onClick={() => openEdit(indiamart)}>
                Configure IndiaMART
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={ensureImMutation.isPending}
                onClick={() => ensureImMutation.mutate()}
              >
                {ensureImMutation.isPending ? "Creating…" : "Create IndiaMART card"}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={!imSetupQuery.data?.configured || syncImMutation.isPending}
              onClick={() => syncImMutation.mutate()}
            >
              {syncImMutation.isPending ? "Syncing…" : "Sync leads now"}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/leads">Open leads</Link>
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Status:{" "}
            {imSetupQuery.data?.channelError
              ? imSetupQuery.data.channelError
              : indiamart
                ? imSetupQuery.data?.configured
                  ? imSetupQuery.data.lastSyncAt
                    ? `CRM key saved. Last sync ${new Date(imSetupQuery.data.lastSyncAt).toLocaleString()}.`
                    : "CRM key saved — run Sync leads now to import enquiries."
                  : "Channel card ready — click Configure IndiaMART and paste your CRM key."
                : "IndiaMART card missing from the grid. Click Create IndiaMART card (requires migration 007)."}
          </p>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {channelsQuery.isLoading ? (
            <Panel>
              <p className="text-sm text-muted-foreground">Loading channels…</p>
            </Panel>
          ) : channels.length === 0 ? (
            <div className="sm:col-span-2 xl:col-span-3">
              <EmptyState
                title="No channels"
                description="Run supabase/migrations/003_core_schema.sql to seed Website, WhatsApp, Email, Instagram, and Facebook."
              />
            </div>
          ) : (
            channels.map((c) => {
              const live = isLiveChannel(c.type);
              const toggling = toggleMutation.isPending && toggleMutation.variables?.channel.id === c.id;
              return (
                <Panel key={c.id} bodyClassName="p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary">
                      <ChannelIcon channel={c.type} className="text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{c.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.detail || c.type}</p>
                    </div>
                    <Switch
                      checked={Boolean(c.is_enabled)}
                      disabled={toggling}
                      aria-label={`Enable ${c.name}`}
                      onCheckedChange={(enabled) => toggleMutation.mutate({ channel: c, enabled })}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Pill tone={channelStatusTone(c.status)} dot>
                      {c.status}
                    </Pill>
                    {live ? (
                      <Pill tone="success">
                        {c.type === "whatsapp"
                          ? "Meta API"
                          : c.type === "email"
                            ? "SMTP"
                            : c.type === "facebook" || c.type === "instagram"
                              ? "Meta Messenger"
                              : c.type === "indiamart"
                                ? "Lead API"
                                : "Live"}
                      </Pill>
                    ) : (
                      <Pill tone="neutral">API later</Pill>
                    )}
                  </div>

                  <div className="mt-3">
                    <p className="mb-1 text-[11px] uppercase text-muted-foreground">Connection health</p>
                    <ScoreBar score={c.health ?? 0} />
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      <span className="num text-foreground">{c.conversationCount}</span> conversations ·{" "}
                      <span className="num text-foreground">{c.openCount}</span> open
                    </span>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => openEdit(c)}>
                      <Pencil className="size-3" /> Configure
                    </Button>
                  </div>
                </Panel>
              );
            })
          )}
        </div>

        <Panel title="Provider roadmap">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Website</span> — live now via embed widget + Inbox.
            </li>
            <li>
              <span className="font-medium text-foreground">WhatsApp</span> — Meta Cloud API webhook + Inbox (configure credentials above).
            </li>
            <li>
              <span className="font-medium text-foreground">Email</span> — SMTP outbound + inbound webhook (SendGrid Parse / forwarder).
            </li>
            <li>
              <span className="font-medium text-foreground">Facebook / Instagram</span> — Meta Page Messaging webhooks + Inbox.
            </li>
            <li>
              <span className="font-medium text-foreground">IndiaMART</span> — Lead Manager Pull/Push → Leads + Inbox follow-up.
            </li>
          </ul>
        </Panel>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Configure {editing?.name}</DialogTitle>
            <DialogDescription>
              {editing?.type === "whatsapp"
                ? "Paste Meta WhatsApp Cloud API credentials. Inbound messages will create Inbox conversations."
                : editing?.type === "email"
                  ? "Enter SMTP credentials for outbound replies. Point inbound mail at the webhook URL on this page."
                  : editing?.type === "facebook" || editing?.type === "instagram"
                    ? "Paste Facebook Page ID and Page access token. Inbound DMs create Inbox conversations."
                    : editing?.type === "indiamart"
                      ? "Paste your IndiaMART Lead Manager CRM key. Sync pulls enquiries into Leads for remarketing."
                      : editing && isLiveChannel(editing.type)
                        ? "Website chat is live. Adjust display name, detail, and health."
                        : "Provider API is not connected yet. You can still rename and mark intent to enable."}
            </DialogDescription>
          </DialogHeader>

          {editing?.type === "whatsapp" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="wa-phone-id">Phone Number ID</Label>
                <Input
                  id="wa-phone-id"
                  value={waPhoneNumberId}
                  onChange={(e) => setWaPhoneNumberId(e.target.value)}
                  placeholder="From Meta → WhatsApp → API Setup"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wa-token">Access Token</Label>
                <Input
                  id="wa-token"
                  type="password"
                  value={waAccessToken}
                  onChange={(e) => setWaAccessToken(e.target.value)}
                  placeholder={
                    (editing.config as { access_token?: string } | null)?.access_token
                      ? "Leave blank to keep existing token"
                      : "Permanent / system user token"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wa-verify">Verify Token</Label>
                <Input
                  id="wa-verify"
                  value={waVerifyToken}
                  onChange={(e) => setWaVerifyToken(e.target.value)}
                  placeholder="Any secret string — must match Meta webhook"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wa-waba">WhatsApp Business Account ID (optional)</Label>
                <Input
                  id="wa-waba"
                  value={waBusinessAccountId}
                  onChange={(e) => setWaBusinessAccountId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wa-display">Display phone (optional)</Label>
                <Input
                  id="wa-display"
                  value={waDisplayPhone}
                  onChange={(e) => setWaDisplayPhone(e.target.value)}
                  placeholder="+91 …"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Webhook callback: <span className="font-medium text-foreground">{webhookUrl}</span>
              </p>
            </div>
          ) : editing?.type === "email" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="email-from">From email</Label>
                <Input
                  id="email-from"
                  type="email"
                  value={emailFrom}
                  onChange={(e) => setEmailFrom(e.target.value)}
                  placeholder="support@yourdomain.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email-from-name">From name</Label>
                <Input
                  id="email-from-name"
                  value={emailFromName}
                  onChange={(e) => setEmailFromName(e.target.value)}
                  placeholder="EnerTech Engage"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-host">SMTP host</Label>
                <Input
                  id="smtp-host"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.gmail.com / smtp.office365.com"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="smtp-port">SMTP port</Label>
                  <Input
                    id="smtp-port"
                    type="number"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    placeholder="587"
                  />
                </div>
                <div className="flex items-end gap-2 pb-2">
                  <Switch id="smtp-secure" checked={smtpSecure} onCheckedChange={setSmtpSecure} />
                  <Label htmlFor="smtp-secure" className="font-normal">
                    TLS on connect (port 465)
                  </Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-user">SMTP user</Label>
                <Input
                  id="smtp-user"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  placeholder="Usually your full email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-pass">SMTP password</Label>
                <Input
                  id="smtp-pass"
                  type="password"
                  value={smtpPass}
                  onChange={(e) => setSmtpPass(e.target.value)}
                  placeholder={
                    (editing.config as { smtp_pass?: string } | null)?.smtp_pass
                      ? "Leave blank to keep existing password"
                      : "App password / SMTP password"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email-secret">Inbound webhook secret (optional)</Label>
                <Input
                  id="email-secret"
                  type="password"
                  value={emailInboundSecret}
                  onChange={(e) => setEmailInboundSecret(e.target.value)}
                  placeholder="Sent as x-enertech-email-secret"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Inbound webhook: <span className="font-medium text-foreground">{emailWebhookUrl}</span>
              </p>
            </div>
          ) : editing?.type === "facebook" || editing?.type === "instagram" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="meta-page-id">Facebook Page ID</Label>
                <Input
                  id="meta-page-id"
                  value={metaPageId}
                  onChange={(e) => setMetaPageId(e.target.value)}
                  placeholder="Numeric Page ID"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meta-token">Page Access Token</Label>
                <Input
                  id="meta-token"
                  type="password"
                  value={metaAccessToken}
                  onChange={(e) => setMetaAccessToken(e.target.value)}
                  placeholder={
                    (editing.config as { access_token?: string } | null)?.access_token
                      ? "Leave blank to keep existing token"
                      : "Page access token from Meta"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meta-verify">Verify Token</Label>
                <Input
                  id="meta-verify"
                  value={metaVerifyToken}
                  onChange={(e) => setMetaVerifyToken(e.target.value)}
                  placeholder="Must match Meta webhook verify token"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meta-page-name">Page / account name (optional)</Label>
                <Input
                  id="meta-page-name"
                  value={metaPageName}
                  onChange={(e) => setMetaPageName(e.target.value)}
                />
              </div>
              {editing.type === "instagram" ? (
                <div className="space-y-2">
                  <Label htmlFor="meta-ig">Instagram account ID (optional)</Label>
                  <Input
                    id="meta-ig"
                    value={metaIgAccountId}
                    onChange={(e) => setMetaIgAccountId(e.target.value)}
                  />
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Webhook:{" "}
                <span className="font-medium text-foreground">
                  {editing.type === "instagram" ? igWebhookUrl : fbWebhookUrl}
                </span>
              </p>
            </div>
          ) : editing?.type === "indiamart" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="im-crm-key">CRM key (glusr_crm_key)</Label>
                <Input
                  id="im-crm-key"
                  type="password"
                  value={imCrmKey}
                  onChange={(e) => setImCrmKey(e.target.value)}
                  placeholder={
                    (editing.config as { crm_key?: string } | null)?.crm_key
                      ? "Leave blank to keep existing key"
                      : "From seller.indiamart.com/leadmanager/crmapi"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="im-push-secret">Push webhook secret (optional)</Label>
                <Input
                  id="im-push-secret"
                  type="password"
                  value={imPushSecret}
                  onChange={(e) => setImPushSecret(e.target.value)}
                  placeholder="Sent as x-enertech-indiamart-secret"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Push webhook: <span className="font-medium text-foreground">{imWebhookUrl}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                After saving, use <span className="font-medium text-foreground">Sync leads now</span> on the
                IndiaMART panel to import enquiries into Leads / Inbox.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="ch-name">Display name</Label>
                <Input id="ch-name" value={formName} onChange={(e) => setFormName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ch-detail">Detail</Label>
                <Input
                  id="ch-detail"
                  value={formDetail}
                  onChange={(e) => setFormDetail(e.target.value)}
                  placeholder={editing?.type === "website" ? "embed widget / domain" : "phone number, inbox, page id…"}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={formStatus} onValueChange={(v: ChannelStatus) => setFormStatus(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ch-health">Health (0–100)</Label>
                  <Input
                    id="ch-health"
                    type="number"
                    min={0}
                    max={100}
                    value={formHealth}
                    onChange={(e) => setFormHealth(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending
                ? "Saving…"
                : editing?.type === "whatsapp" ||
                    editing?.type === "email" ||
                    editing?.type === "facebook" ||
                    editing?.type === "instagram" ||
                    editing?.type === "indiamart"
                  ? "Save & connect"
                  : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
