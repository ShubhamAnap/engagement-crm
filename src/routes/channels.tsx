import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Mail, Pencil, RefreshCw } from "lucide-react";
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
  EmptyState,
  PageHeader,
  Panel,
  Pill,
  ScoreBar,
  StatCard,
} from "@/components/shared/ui-kit";
import { ChannelBrandMark } from "@/components/shared/ChannelBrandMark";
import { getChannelBrand } from "@/lib/channel-brand";
import { useAuth } from "@/lib/auth";
import { ENERTECH_ORG_ID } from "@/lib/chat-api";
import {
  channelStatusTone,
  getChannelConfig,
  isLiveChannel,
  listChannelsWithStats,
  setChannelEnabled,
  updateChannel,
  updateWebsiteAllowedOrigins,
  type ChannelWithStats,
} from "@/lib/channels-api";
import {
  formatAllowedOriginsText,
  parseAllowedOriginsText,
} from "@/lib/widget-origins";
import { Textarea } from "@/components/ui/textarea";
import { getWhatsAppSetupInfo, saveWhatsAppChannelConfig, testWhatsAppConnection } from "@/server/whatsapp";
import { getEmailSetupInfo, saveEmailChannelConfig } from "@/server/email";
import {
  disconnectGmail,
  getGmailConnectUrl,
  getGmailSetupInfo,
  saveGmailOAuthAppConfig,
} from "@/server/gmail-api";
import { getMetaSetupInfo, saveMetaChannelConfig } from "@/server/meta-messenger";
import {
  cancelIndiaMartBackfillFn,
  ensureIndiaMartChannel,
  getIndiaMartSetupInfo,
  saveIndiaMartAutoSync,
  saveIndiaMartChannelConfig,
  startIndiaMartBackfillFn,
  syncIndiaMartLeads,
} from "@/server/indiamart";
import {
  cancelTradeIndiaBackfillFn,
  ensureTradeIndiaChannel,
  getTradeIndiaSetup,
  saveTradeIndiaAutoSync,
  saveTradeIndiaChannelConfig,
  startTradeIndiaBackfillFn,
  syncTradeIndiaLeads,
} from "@/server/tradeindia";
import {
  AUTO_SYNC_DAILY_TIME_OPTIONS,
  AUTO_SYNC_SCHEDULE_OPTIONS,
  describeAutoSync,
  type AutoSyncSchedule,
} from "@/lib/marketplace-auto-sync";
import {
  ensureBrainmineChannel,
  getBrainmineSetup,
  inspectBrainmineLeadFields,
  runBrainmineAutoSyncNow,
  saveBrainmineAutoSync,
  saveBrainmineChannelConfig,
  syncBrainmineLeads,
} from "@/server/brainmine";
import { writeBrainmineFollowUpsNow, inspectBrainmineWritebackFields, saveBrainmineWritebackMap } from "@/server/brainmine-writeback";
import {
  WORDPRESS_DEFAULT_SITE,
  ensureWordpressChannel,
  getWordpressSetup,
  inspectWordpressCatalog,
  saveWordpressChannelConfig,
  syncWordpressCatalog,
} from "@/server/wordpress-catalog";
import type { ChannelStatus } from "@/lib/db-types";
import type { BrainmineAuthStyle, BrainmineIntervalUnit } from "@/server/brainmine";

const statusOptions: ChannelStatus[] = ["Connected", "Degraded", "Disconnected", "Action Required"];

export const Route = createFileRoute("/channels")({
  validateSearch: (search: Record<string, unknown>): { gmail?: string; email?: string; message?: string } => ({
    gmail: typeof search.gmail === "string" ? search.gmail : undefined,
    email: typeof search.email === "string" ? search.email : undefined,
    message: typeof search.message === "string" ? search.message : undefined,
  }),
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
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
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
  const [gmailClientId, setGmailClientId] = useState("");
  const [gmailClientSecret, setGmailClientSecret] = useState("");
  const [gmailCredOpen, setGmailCredOpen] = useState(false);
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
  const [imBackfillFrom, setImBackfillFrom] = useState("");
  const [imBackfillTo, setImBackfillTo] = useState("");
  const [tiBackfillFrom, setTiBackfillFrom] = useState("");
  const [tiBackfillTo, setTiBackfillTo] = useState("");
  const [tiUserid, setTiUserid] = useState("");
  const [tiProfileId, setTiProfileId] = useState("");
  const [tiKey, setTiKey] = useState("");
  const [bmApiBaseUrl, setBmApiBaseUrl] = useState("");
  const [bmApiKey, setBmApiKey] = useState("");
  const [bmApiSecret, setBmApiSecret] = useState("");
  const [bmAuthStyle, setBmAuthStyle] = useState<BrainmineAuthStyle>("token");
  const [bmLeadsPath, setBmLeadsPath] = useState("/api/resource/Lead");
  const [bmSyncLimit, setBmSyncLimit] = useState("30");
  const [bmRangeFrom, setBmRangeFrom] = useState("");
  const [bmRangeTo, setBmRangeTo] = useState("");
  const [bmAutoEnabled, setBmAutoEnabled] = useState(true);
  const [bmIntervalValue, setBmIntervalValue] = useState("5");
  const [bmIntervalUnit, setBmIntervalUnit] = useState<BrainmineIntervalUnit>("min");
  const [bmAutoFormReady, setBmAutoFormReady] = useState(false);
  const [bmInspectOpen, setBmInspectOpen] = useState(false);
  const [bmInspectResult, setBmInspectResult] = useState<Awaited<
    ReturnType<typeof inspectBrainmineLeadFields>
  > | null>(null);
  const [bmWritebackInspectOpen, setBmWritebackInspectOpen] = useState(false);
  const [bmWritebackInspectResult, setBmWritebackInspectResult] = useState<Awaited<
    ReturnType<typeof inspectBrainmineWritebackFields>
  > | null>(null);
  const [wbTable, setWbTable] = useState("");
  const [wbTypeField, setWbTypeField] = useState("follow_up_type");
  const [wbContactField, setWbContactField] = useState("contact_with");
  const [wbNextDateField, setWbNextDateField] = useState("next_follow_up_date");
  const [wbDescField, setWbDescField] = useState("description");
  const [websiteOriginsText, setWebsiteOriginsText] = useState("");
  const [websiteOriginsLoaded, setWebsiteOriginsLoaded] = useState(false);
  const [wpSiteUrl, setWpSiteUrl] = useState(WORDPRESS_DEFAULT_SITE);
  const [wpConsumerKey, setWpConsumerKey] = useState("");
  const [wpConsumerSecret, setWpConsumerSecret] = useState("");
  const [wpInspectOpen, setWpInspectOpen] = useState(false);
  const [wpInspectResult, setWpInspectResult] = useState<Awaited<
    ReturnType<typeof inspectWordpressCatalog>
  > | null>(null);

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

  const gmailSetupQuery = useQuery({
    queryKey: ["gmail-setup"],
    queryFn: () => getGmailSetupInfo(),
  });

  useEffect(() => {
    if (!search.gmail) return;
    if (search.gmail === "connected") {
      toast.success(`Gmail connected${search.email ? `: ${search.email}` : ""}`);
      void queryClient.invalidateQueries({ queryKey: ["gmail-setup"] });
      void queryClient.invalidateQueries({ queryKey: ["email-setup"] });
      void queryClient.invalidateQueries({ queryKey: ["channels", orgId] });
    } else if (search.gmail === "error") {
      toast.error(search.message || "Gmail connect failed");
    }
    void navigate({ to: "/channels", search: {}, replace: true });
  }, [search.gmail, search.email, search.message, navigate, queryClient, orgId]);

  const saveGmailCredMutation = useMutation({
    mutationFn: () =>
      saveGmailOAuthAppConfig({
        data: { clientId: gmailClientId.trim(), clientSecret: gmailClientSecret.trim() },
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["gmail-setup"] });
      setGmailCredOpen(false);
      setGmailClientSecret("");
      toast.success("Gmail OAuth credentials saved", {
        description: `Redirect URI: ${result.redirectUri}`,
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save Gmail credentials"),
  });

  const connectGmailMutation = useMutation({
    mutationFn: () => getGmailConnectUrl(),
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not start Gmail connect"),
  });

  const disconnectGmailMutation = useMutation({
    mutationFn: () => disconnectGmail(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["gmail-setup"] });
      await queryClient.invalidateQueries({ queryKey: ["email-setup"] });
      toast.message("Gmail disconnected");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Disconnect failed"),
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
    refetchInterval: (q) => {
      const bf = q.state.data?.backfill;
      if (bf?.status === "running" || bf?.status === "waiting") return 30_000;
      if ((q.state.data?.cooldownMs ?? 0) > 0) return 30_000;
      return false;
    },
  });

  useEffect(() => {
    const earliest = imSetupQuery.data?.backfillEarliestDate;
    const latest = imSetupQuery.data?.backfillLatestDate;
    if (!earliest || !latest) return;
    setImBackfillFrom((prev) => prev || earliest);
    setImBackfillTo((prev) => prev || latest);
  }, [imSetupQuery.data?.backfillEarliestDate, imSetupQuery.data?.backfillLatestDate]);

  const tiSetupQuery = useQuery({
    queryKey: ["tradeindia-setup"],
    queryFn: () => getTradeIndiaSetup(),
    refetchInterval: (q) => {
      const bf = q.state.data?.backfill;
      if (bf?.status === "running" || bf?.status === "waiting") return 20_000;
      if ((q.state.data?.cooldownMs ?? 0) > 0) return 20_000;
      return false;
    },
  });

  useEffect(() => {
    const earliest = tiSetupQuery.data?.backfillEarliestDate;
    const latest = tiSetupQuery.data?.backfillLatestDate;
    if (!earliest || !latest) return;
    setTiBackfillFrom((prev) => prev || earliest);
    setTiBackfillTo((prev) => prev || latest);
  }, [tiSetupQuery.data?.backfillEarliestDate, tiSetupQuery.data?.backfillLatestDate]);

  const bmSetupQuery = useQuery({
    queryKey: ["brainmine-setup"],
    queryFn: () => getBrainmineSetup(),
    refetchInterval: (q) => (q.state.data?.autoSyncEnabled ? 60_000 : false),
  });

  const wpSetupQuery = useQuery({
    queryKey: ["wordpress-setup"],
    queryFn: () => getWordpressSetup(),
  });

  useEffect(() => {
    const earliest = bmSetupQuery.data?.rangeEarliestDate;
    const latest = bmSetupQuery.data?.rangeLatestDate;
    if (!earliest || !latest) return;
    // Default: last 7 days → today (date-wise pull like IndiaMART)
    const weekAgo = new Date();
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);
    const weekAgoStr = weekAgo.toISOString().slice(0, 10);
    setBmRangeFrom((prev) => prev || (weekAgoStr < earliest ? earliest : weekAgoStr));
    setBmRangeTo((prev) => prev || latest);
  }, [bmSetupQuery.data?.rangeEarliestDate, bmSetupQuery.data?.rangeLatestDate]);

  useEffect(() => {
    if (!bmSetupQuery.data || bmAutoFormReady) return;
    setBmAutoEnabled(Boolean(bmSetupQuery.data.autoSyncEnabled));
    setBmIntervalValue(String(bmSetupQuery.data.autoSyncIntervalValue || 5));
    setBmIntervalUnit(bmSetupQuery.data.autoSyncIntervalUnit || "min");
    setBmAutoFormReady(true);
  }, [bmSetupQuery.data, bmAutoFormReady]);

  const channels = channelsQuery.data ?? [];
  const connected = channels.filter((c) => c.status === "Connected").length;
  const enabled = channels.filter((c) => c.is_enabled).length;
  const openThreads = channels.reduce((sum, c) => sum + c.openCount, 0);
  const website = channels.find((c) => c.type === "website");
  const whatsapp = channels.find((c) => c.type === "whatsapp");

  useEffect(() => {
    if (!website || websiteOriginsLoaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await getChannelConfig(website.id);
        if (cancelled) return;
        const list = Array.isArray(raw.allowed_origins)
          ? raw.allowed_origins.map(String)
          : [];
        setWebsiteOriginsText(formatAllowedOriginsText(list));
      } catch {
        if (!cancelled) setWebsiteOriginsText("");
      } finally {
        if (!cancelled) setWebsiteOriginsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [website, websiteOriginsLoaded]);

  const emailChannel = channels.find((c) => c.type === "email");
  const facebook = channels.find((c) => c.type === "facebook");
  const instagram = channels.find((c) => c.type === "instagram");
  const indiamart = channels.find((c) => c.type === "indiamart");
  const tradeindia = channels.find((c) => c.type === "tradeindia");
  const brainmine = channels.find((c) => c.type === "brainmine");
  const wordpress = channels.find((c) => c.type === "wordpress");
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
      queryClient.invalidateQueries({ queryKey: ["tradeindia-setup"] }),
      queryClient.invalidateQueries({ queryKey: ["brainmine-setup"] }),
      queryClient.invalidateQueries({ queryKey: ["wordpress-setup"] }),
    ]);
  };

  const toggleMutation = useMutation({
    mutationFn: async ({ channel, enabled }: { channel: ChannelWithStats; enabled: boolean }) => {
      if (channel.type === "whatsapp" && enabled && !waSetupQuery.data?.configured) {
        throw new Error("Configure Meta WhatsApp credentials first (Configure on the WhatsApp card).");
      }
      if (channel.type === "email" && enabled && !emailSetupQuery.data?.configured && !gmailSetupQuery.data?.connected) {
        throw new Error("Connect Gmail (OAuth) or configure SMTP first.");
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
      if (channel.type === "tradeindia" && enabled && !tiSetupQuery.data?.configured) {
        throw new Error("Configure TradeIndia userid, profile_id, and key first.");
      }
      if (channel.type === "brainmine" && enabled && !bmSetupQuery.data?.configured) {
        throw new Error("Configure Brainmine API URL and key first.");
      }
      if (channel.type === "wordpress" && enabled && !wpSetupQuery.data?.configured) {
        throw new Error("Save the WordPress site URL first (Configure on the WordPress card).");
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

  const saveWebsiteOriginsMutation = useMutation({
    mutationFn: async () => {
      if (!website) throw new Error("Website channel not found. Run core schema seed if missing.");
      const allowedOrigins = parseAllowedOriginsText(websiteOriginsText);
      return updateWebsiteAllowedOrigins({
        channelId: website.id,
        allowedOrigins,
      });
    },
    onSuccess: async (data) => {
      const raw = data.config && typeof data.config === "object" ? data.config : {};
      const list = Array.isArray((raw as { allowed_origins?: unknown }).allowed_origins)
        ? ((raw as { allowed_origins: unknown[] }).allowed_origins.map(String))
        : [];
      setWebsiteOriginsText(formatAllowedOriginsText(list));
      await invalidate();
      toast.success(
        list.length > 0
          ? `Allowed ${list.length} domain${list.length === 1 ? "" : "s"} (subdomains + paths included)`
          : "Allowlist cleared — widget blocked off-app (preview hosts still work)",
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save allowed origins"),
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

      if (editing.type === "tradeindia") {
        const existing = (editing.config || {}) as {
          userid?: string;
          profile_id?: string;
          key?: string;
        };
        const userid = tiUserid.trim() || existing.userid || "";
        const profileId = tiProfileId.trim() || existing.profile_id || "";
        const key = tiKey.trim() || existing.key || "";
        if (!userid) throw new Error("TradeIndia userid is required");
        if (!profileId) throw new Error("TradeIndia profile_id is required");
        if (!key) throw new Error("TradeIndia API key is required");
        return saveTradeIndiaChannelConfig({
          data: { userid, profileId, key, enable: true },
        });
      }

      if (editing.type === "brainmine") {
        const existing = (editing.config || {}) as {
          api_base_url?: string;
          api_key?: string;
          api_secret?: string;
          sync_limit?: number;
        };
        const base =
          bmApiBaseUrl.trim() ||
          existing.api_base_url ||
          bmSetupQuery.data?.apiBaseUrl ||
          "";
        const key = bmApiKey.trim() || existing.api_key || "";
        if (!base) throw new Error("Brainmine API base URL is required");
        if (!key && !bmSetupQuery.data?.hasKey) {
          throw new Error("Brainmine API key is required (UI or BRAINMINE_API_KEY in .env)");
        }
        const syncLimit = Number(bmSyncLimit) || bmSetupQuery.data?.syncLimit || 30;
        return saveBrainmineChannelConfig({
          data: {
            apiBaseUrl: base,
            apiKey: key || undefined,
            apiSecret: bmApiSecret.trim() || existing.api_secret || undefined,
            authStyle: bmAuthStyle,
            leadsPath: bmLeadsPath.trim() || "/api/resource/Lead",
            syncLimit,
            enable: true,
          },
        });
      }

      if (editing.type === "wordpress") {
        const existing = (editing.config || {}) as {
          site_url?: string;
          consumer_key?: string;
          consumer_secret?: string;
        };
        const site =
          wpSiteUrl.trim() ||
          existing.site_url ||
          wpSetupQuery.data?.siteUrl ||
          WORDPRESS_DEFAULT_SITE;
        if (!site) throw new Error("WordPress site URL is required");
        return saveWordpressChannelConfig({
          data: {
            siteUrl: site,
            consumerKey: wpConsumerKey.trim() || undefined,
            consumerSecret: wpConsumerSecret.trim() || undefined,
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

  async function openEdit(channel: ChannelWithStats) {
    const canManageSecrets =
      profile?.role === "Admin" || profile?.role === "Manager";
    let cfg: Record<string, unknown> = {};
    if (canManageSecrets) {
      try {
        cfg = await getChannelConfig(channel.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load channel secrets");
        return;
      }
    } else {
      toast.error("Only Admin or Manager can open channel credentials");
      return;
    }

    const withConfig: ChannelWithStats = { ...channel, config: cfg };
    setEditing(withConfig);
    setFormName(channel.name);
    setFormDetail(channel.detail || "");
    setFormStatus(channel.status);
    setFormHealth(String(channel.health ?? 0));
    if (channel.type === "whatsapp") {
      const c = cfg as {
        phone_number_id?: string;
        access_token?: string;
        verify_token?: string;
        business_account_id?: string;
        display_phone?: string;
      };
      setWaPhoneNumberId(c.phone_number_id || "");
      setWaAccessToken("");
      setWaVerifyToken(c.verify_token || "");
      setWaBusinessAccountId(c.business_account_id || "");
      setWaDisplayPhone(c.display_phone || channel.detail || "");
    }
    if (channel.type === "email") {
      const c = cfg as {
        from_email?: string;
        from_name?: string;
        smtp_host?: string;
        smtp_port?: number;
        smtp_secure?: boolean;
        smtp_user?: string;
        smtp_pass?: string;
        inbound_secret?: string;
      };
      setEmailFrom(c.from_email || channel.detail || "");
      setEmailFromName(c.from_name || "EnerTech Engage");
      setSmtpHost(c.smtp_host || "");
      setSmtpPort(String(c.smtp_port || 587));
      setSmtpSecure(Boolean(c.smtp_secure));
      setSmtpUser(c.smtp_user || "");
      setSmtpPass("");
      setEmailInboundSecret(c.inbound_secret || "");
    }
    if (channel.type === "facebook" || channel.type === "instagram") {
      const c = cfg as {
        page_id?: string;
        access_token?: string;
        verify_token?: string;
        page_name?: string;
        ig_account_id?: string;
      };
      setMetaPageId(c.page_id || "");
      setMetaAccessToken("");
      setMetaVerifyToken(c.verify_token || "");
      setMetaPageName(c.page_name || channel.detail || "");
      setMetaIgAccountId(c.ig_account_id || "");
    }
    if (channel.type === "indiamart") {
      const c = cfg as { crm_key?: string; push_secret?: string };
      setImCrmKey("");
      setImPushSecret(c.push_secret || "");
    }
    if (channel.type === "tradeindia") {
      const c = cfg as {
        userid?: string;
        profile_id?: string;
        key?: string;
      };
      setTiUserid(c.userid || tiSetupQuery.data?.userid || "");
      setTiProfileId(c.profile_id || tiSetupQuery.data?.profileId || "");
      setTiKey("");
    }
    if (channel.type === "brainmine") {
      const c = cfg as {
        api_base_url?: string;
        api_key?: string;
        api_secret?: string;
        auth_style?: BrainmineAuthStyle;
        leads_path?: string;
        sync_limit?: number;
      };
      setBmApiBaseUrl(c.api_base_url || bmSetupQuery.data?.apiBaseUrl || "https://brainmineai.in");
      setBmApiKey("");
      setBmApiSecret("");
      setBmAuthStyle(c.auth_style || (bmSetupQuery.data?.authStyle as BrainmineAuthStyle) || "token");
      setBmLeadsPath(c.leads_path || bmSetupQuery.data?.leadsPath || "/api/resource/Lead");
      setBmSyncLimit(String(c.sync_limit || bmSetupQuery.data?.syncLimit || 30));
    }
    if (channel.type === "wordpress") {
      const c = cfg as {
        site_url?: string;
        consumer_key?: string;
        consumer_secret?: string;
      };
      setWpSiteUrl(c.site_url || wpSetupQuery.data?.siteUrl || WORDPRESS_DEFAULT_SITE);
      setWpConsumerKey("");
      setWpConsumerSecret("");
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
    onError: async (error) => {
      await queryClient.invalidateQueries({ queryKey: ["indiamart-setup"] });
      toast.error(error instanceof Error ? error.message : "Sync failed");
    },
  });

  const imAutoSyncMutation = useMutation({
    mutationFn: (payload: { enabled: boolean; schedule?: AutoSyncSchedule; dailyTime?: string }) =>
      saveIndiaMartAutoSync({ data: payload }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["indiamart-setup"] });
      toast.success(
        result.autoSyncEnabled
          ? "IndiaMART auto sync on"
          : "IndiaMART auto sync off — use Sync leads now",
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not update auto sync"),
  });

  const startImBackfillMutation = useMutation({
    mutationFn: () =>
      startIndiaMartBackfillFn({
        data: { from: imBackfillFrom, to: imBackfillTo },
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["indiamart-setup"] });
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success(result.message);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not start backfill"),
  });

  const cancelImBackfillMutation = useMutation({
    mutationFn: () => cancelIndiaMartBackfillFn(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["indiamart-setup"] });
      toast.message("IndiaMART backfill cancelled");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not cancel backfill"),
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

  const testWaMutation = useMutation({
    mutationFn: () => testWhatsAppConnection(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-setup"] });
      await invalidate();
      const tplNote =
        typeof result.templateCount === "number"
          ? ` · ${result.templateCount} Meta template${result.templateCount === 1 ? "" : "s"}`
          : "";
      toast.success(
        result.verifiedName
          ? `Connected: ${result.verifiedName}${result.displayPhone ? ` (${result.displayPhone})` : ""}${tplNote}`
          : `WhatsApp API OK${result.displayPhone ? ` · ${result.displayPhone}` : ""}${tplNote}`,
        {
          description: result.wabaCorrected
            ? "Correct WABA ID auto-detected and saved — go to Broadcasting → Sync from Meta."
            : result.needsPublicHttps
              ? "Credentials work. For inbound messages, expose HTTPS (ngrok) and set Meta webhook — localhost won't receive callbacks."
              : result.templateCount
                ? "Credentials work. Use Broadcasting → Sync from Meta to pull templates."
                : "Credentials work. Confirm Meta webhook is verified and subscribed to messages.",
        },
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "WhatsApp connection test failed"),
  });

  const syncTiMutation = useMutation({
    mutationFn: () => syncTradeIndiaLeads({ data: { hours: 24 } }),
    onSuccess: async (result) => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["automation-approvals"] });
      toast.success(
        `TradeIndia sync: ${result.created} new · ${result.skipped} duplicates · ${result.fetched} fetched`,
      );
      if (result.errors.length) {
        toast.message("Some enquiries failed", { description: result.errors[0] });
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "TradeIndia sync failed"),
  });

  const tiAutoSyncMutation = useMutation({
    mutationFn: (payload: { enabled: boolean; schedule?: AutoSyncSchedule; dailyTime?: string }) =>
      saveTradeIndiaAutoSync({ data: payload }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["tradeindia-setup"] });
      toast.success(
        result.autoSyncEnabled
          ? "TradeIndia auto sync on"
          : "TradeIndia auto sync off — use Sync leads now",
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not update auto sync"),
  });

  const startTiBackfillMutation = useMutation({
    mutationFn: () =>
      startTradeIndiaBackfillFn({
        data: { from: tiBackfillFrom, to: tiBackfillTo },
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["tradeindia-setup"] });
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success(result.message);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not start TradeIndia backfill"),
  });

  const cancelTiBackfillMutation = useMutation({
    mutationFn: () => cancelTradeIndiaBackfillFn(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tradeindia-setup"] });
      toast.message("TradeIndia backfill cancelled");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not cancel backfill"),
  });

  const ensureTiMutation = useMutation({
    mutationFn: () => ensureTradeIndiaChannel(),
    onSuccess: async (result) => {
      await invalidate();
      if (!result.ok) {
        toast.error(result.error || "Could not create TradeIndia channel");
        return;
      }
      toast.success(
        result.created ? "TradeIndia channel card created" : "TradeIndia channel already exists",
      );
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not create channel"),
  });

  const syncBmMutation = useMutation({
    mutationFn: (range?: { from: string; to: string }) =>
      syncBrainmineLeads({ data: range ?? {} }),
    onSuccess: async (result) => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      await queryClient.invalidateQueries({ queryKey: ["brainmine-setup"] });
      const rangeLabel =
        result.from && result.to ? ` (${result.from} → ${result.to})` : "";
      toast.success(
        `Brainmine sync${rangeLabel}: ${result.created} new · ${result.updated} updated · ${result.skipped} skipped · ${result.fetched} fetched`,
      );
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Brainmine sync failed"),
  });

  const bmAutoSyncMutation = useMutation({
    mutationFn: (payload: {
      enabled: boolean;
      intervalValue: number;
      intervalUnit: BrainmineIntervalUnit;
    }) => saveBrainmineAutoSync({ data: payload }),
    onSuccess: async (result) => {
      setBmAutoFormReady(false);
      await queryClient.invalidateQueries({ queryKey: ["brainmine-setup"] });
      await invalidate();
      toast.success(
        result.autoSyncEnabled
          ? `Brainmine auto sync saved — every ${result.autoSyncIntervalValue} ${result.autoSyncIntervalUnit}. Next cron (~5 min) will pull soon.`
          : "Brainmine auto sync off — use Sync leads now",
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save Brainmine auto sync"),
  });

  const bmRunAutoNowMutation = useMutation({
    mutationFn: () => runBrainmineAutoSyncNow(),
    onSuccess: async (result) => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      await queryClient.invalidateQueries({ queryKey: ["brainmine-setup"] });
      toast.success(
        `Auto sync ran: ${result.created} new · ${result.updated} updated · ${result.fetched} fetched`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Auto sync failed"),
  });

  const inspectBmMutation = useMutation({
    mutationFn: () => inspectBrainmineLeadFields(),
    onSuccess: (result) => {
      setBmInspectResult(result);
      setBmInspectOpen(true);
      toast.success(
        `Inspected ${result.leadId}: ${result.candidatesFromSample.length} requirement-like fields with data`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not inspect Brainmine fields"),
  });

  const inspectWbMutation = useMutation({
    mutationFn: () => inspectBrainmineWritebackFields(),
    onSuccess: (result) => {
      setBmWritebackInspectResult(result);
      const rec = result.recommendedMap;
      setWbTable(rec.follow_up_table);
      setWbTypeField(rec.type_field);
      setWbContactField(rec.contact_field);
      setWbNextDateField(rec.next_date_field);
      setWbDescField(rec.description_field);
      setBmWritebackInspectOpen(true);
      toast.success(`Write-back inspect: sample ${result.sampleId}`);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not inspect write-back fields"),
  });

  const saveWbMapMutation = useMutation({
    mutationFn: () =>
      saveBrainmineWritebackMap({
        data: {
          follow_up_table: wbTable.trim(),
          type_field: wbTypeField.trim(),
          contact_field: wbContactField.trim(),
          next_date_field: wbNextDateField.trim(),
          description_field: wbDescField.trim(),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["brainmine-setup"] });
      toast.success("Follow-up write-back mapping saved — try Write follow-ups again");
      setBmWritebackInspectOpen(false);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save write-back mapping"),
  });

  const writebackBmMutation = useMutation({
    mutationFn: () => writeBrainmineFollowUpsNow(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["brainmine-setup"] });
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      const summary = `${result.written} written · ${result.skipped} skipped · ${result.failed} failed`;
      if (result.written > 0 && result.failed === 0) {
        toast.success(`Brainmine write-back: ${summary}`);
      } else if (result.written > 0) {
        toast.message(`Brainmine write-back partial: ${summary}`);
      } else {
        toast.error(
          `Brainmine write-back: nothing written (${summary}). Check Follow-up summary / Note on the lead, brainmine id, and Inspect write-back fields.`,
        );
      }
      if (result.errors.length) {
        toast.message("Write-back detail", { description: result.errors[0] });
      }
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Brainmine write-back failed"),
  });

  const ensureWpMutation = useMutation({
    mutationFn: () => ensureWordpressChannel(),
    onSuccess: async (result) => {
      await invalidate();
      if (!result.ok) {
        toast.error(result.error || "Could not create WordPress channel");
        return;
      }
      toast.success(result.created ? "WordPress channel card created" : "WordPress channel already exists");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not create channel"),
  });

  const inspectWpMutation = useMutation({
    mutationFn: () => inspectWordpressCatalog(),
    onSuccess: (result) => {
      setWpInspectResult(result);
      setWpInspectOpen(true);
      toast.success(
        result.storeApiOk || result.restV3Ok
          ? `Inspected ${result.sample.length} sample products${result.estimatedTotal ? ` (≈${result.estimatedTotal} published)` : ""}`
          : "Inspect finished — see details",
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not inspect WordPress catalog"),
  });

  const syncWpMutation = useMutation({
    mutationFn: () => syncWordpressCatalog(),
    onSuccess: async (result) => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(
        `WordPress sync: ${result.created} new · ${result.updated} updated · ${result.fetched} pulled`,
      );
      if (result.deactivated) {
        toast.message(`${result.deactivated} Woo products no longer published — marked inactive`);
      }
      if (result.errors.length) {
        toast.message("Some products failed", { description: result.errors[0] });
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "WordPress sync failed"),
  });

  const ensureBmMutation = useMutation({
    mutationFn: () => ensureBrainmineChannel(),
    onSuccess: async (result) => {
      await invalidate();
      if (!result.ok) {
        toast.error(result.error || "Could not create Brainmine channel");
        return;
      }
      toast.success(result.created ? "Brainmine channel card created" : "Brainmine channel already exists");
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

  useEffect(() => {
    if (tiSetupQuery.data?.channelCreated || (tiSetupQuery.data?.channelReady && !tradeindia)) {
      void queryClient.invalidateQueries({ queryKey: ["channels", orgId] });
    }
  }, [
    tiSetupQuery.data?.channelCreated,
    tiSetupQuery.data?.channelReady,
    tradeindia,
    orgId,
    queryClient,
  ]);

  useEffect(() => {
    if (bmSetupQuery.data?.channelCreated || (bmSetupQuery.data?.channelReady && !brainmine)) {
      void queryClient.invalidateQueries({ queryKey: ["channels", orgId] });
    }
  }, [
    bmSetupQuery.data?.channelCreated,
    bmSetupQuery.data?.channelReady,
    brainmine,
    orgId,
    queryClient,
  ]);

  useEffect(() => {
    if (wpSetupQuery.data?.channelCreated || (wpSetupQuery.data?.channelReady && !wordpress)) {
      void queryClient.invalidateQueries({ queryKey: ["channels", orgId] });
    }
  }, [
    wpSetupQuery.data?.channelCreated,
    wpSetupQuery.data?.channelReady,
    wordpress,
    orgId,
    queryClient,
  ]);

  return (
    <>
      <PageHeader
        title="Channels"
        description="Manage customer touchpoints including Meta, IndiaMART, TradeIndia, Brainmine CRM+, and WordPress product catalog."
        meta={
          <div className="flex flex-wrap gap-2">
            <Pill tone={website?.is_enabled ? "success" : "warning"} dot>
              {website?.is_enabled ? "Website live" : "Website off"}
            </Pill>
            <Pill tone={waSetupQuery.data?.configured && whatsapp?.is_enabled ? "success" : "warning"} dot>
              {waSetupQuery.data?.configured && whatsapp?.is_enabled ? "WhatsApp live" : "WhatsApp setup"}
            </Pill>
            <Pill tone={gmailSetupQuery.data?.connected ? "success" : "warning"} dot>
              {gmailSetupQuery.data?.connected
                ? `Gmail · ${gmailSetupQuery.data.email}`
                : "Gmail OAuth setup"}
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

        <Panel
          title="Gmail OAuth (n8n-style)"
          description="Connect Google like an n8n Gmail credential — Client ID, Client Secret, then Sign in with Google."
          action={
            <Pill tone={gmailSetupQuery.data?.connected ? "success" : "warning"} dot>
              {gmailSetupQuery.data?.connected ? "Connected" : "Not connected"}
            </Pill>
          }
        >
          <div className="mb-3 flex items-start gap-3 rounded-lg border border-border bg-secondary/40 p-3">
            <Mail className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0 text-sm text-muted-foreground">
              <p>
                Redirect URI:{" "}
                <code className="break-all rounded bg-background px-1 text-[11px] text-foreground">
                  {gmailSetupQuery.data?.redirectUri || `${appUrl}/api/oauth/gmail/callback`}
                </code>
              </p>
              <p className="mt-1">
                Status:{" "}
                <span className="font-medium text-foreground">
                  {gmailSetupQuery.data?.connected
                    ? gmailSetupQuery.data.email
                    : gmailSetupQuery.data?.credentialsConfigured
                      ? "Credentials saved — click Connect with Google"
                      : "Set OAuth credentials first"}
                </span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setGmailCredOpen(true)}>
              {gmailSetupQuery.data?.credentialsConfigured ? "Edit OAuth credentials" : "Set OAuth credentials"}
            </Button>
            <Button
              size="sm"
              disabled={!gmailSetupQuery.data?.credentialsConfigured || connectGmailMutation.isPending}
              onClick={() => connectGmailMutation.mutate()}
            >
              {connectGmailMutation.isPending ? "Redirecting…" : "Connect with Google"}
            </Button>
            {gmailSetupQuery.data?.connected ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={disconnectGmailMutation.isPending}
                onClick={() => disconnectGmailMutation.mutate()}
              >
                Disconnect
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" asChild>
              <Link to="/broadcasting">Open Broadcasting → Gmail</Link>
            </Button>
          </div>
        </Panel>

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
            . Turn the Website channel <strong>Off</strong> above to stop all widget replies.
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            Welcome WhatsApp uses automation trigger <code className="rounded bg-secondary px-1">website_visitor_captured</code>{" "}
            (not <code className="rounded bg-secondary px-1">lead_created</code>). In-app ASK preview and live embed use
            different browser session keys — test the real site (or demo) for production behavior.
          </p>
          {!widgetKey ? (
            <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">
              Set <code className="rounded bg-secondary px-1">WIDGET_PUBLIC_KEY</code> and{" "}
              <code className="rounded bg-secondary px-1">VITE_WIDGET_PUBLIC_KEY</code> to the <strong>same</strong> value
              in <code className="rounded bg-secondary px-1">.env</code> (and Render), then restart / redeploy.
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
          title="Website chat — allowed domains"
          description="Only these sites can load the widget. Empty list blocks every site except the app preview hosts."
        >
          <p className="mb-3 text-sm text-muted-foreground">
            Enter one domain per line (e.g. <code className="rounded bg-secondary px-1">enertechups.com</code>).
            Subdomains (<code className="rounded bg-secondary px-1">www.</code>,{" "}
            <code className="rounded bg-secondary px-1">shop.</code>) and all paths are allowed automatically.
            Always allowed: this app URL, localhost, and{" "}
            <code className="rounded bg-secondary px-1">enertechups-ai.onrender.com</code>.
            Empty list blocks customer sites — add your live domain before go-live.
          </p>
          {!website ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Website channel row missing — run the core schema seed in Supabase.
            </p>
          ) : (
            <>
              <Label htmlFor="website-allowed-origins" className="sr-only">
                Allowed domains
              </Label>
              <Textarea
                id="website-allowed-origins"
                value={websiteOriginsText}
                onChange={(e) => setWebsiteOriginsText(e.target.value)}
                placeholder={"enertechups.com\nexample.com"}
                rows={5}
                className="font-mono text-xs"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={!website || saveWebsiteOriginsMutation.isPending}
                  onClick={() => saveWebsiteOriginsMutation.mutate()}
                >
                  {saveWebsiteOriginsMutation.isPending ? "Saving…" : "Save allowed domains"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {website.detail || "No origins set — widget blocked off-app"}
                </span>
              </div>
            </>
          )}
        </Panel>

        <Panel
          title="WhatsApp (Meta Cloud API)"
          description="Connect Meta WhatsApp so inbound chats appear in Inbox like Website chat."
        >
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Meta Developer → create / open an app → add <strong>WhatsApp</strong> product →{" "}
              <strong>API Setup</strong>.
            </li>
            <li>
              Copy <strong>Phone number ID</strong>, create a permanent / system-user{" "}
              <strong>Access Token</strong>, and note <strong>WhatsApp Business Account ID</strong>{" "}
              (needed for Broadcasting templates).
            </li>
            <li>
              Click <span className="font-medium text-foreground">Configure WhatsApp</span> below —
              paste those values + a Verify Token you invent (any secret string).
            </li>
            <li>
              Click <span className="font-medium text-foreground">Test connection</span> to verify the
              token with Meta (works on localhost).
            </li>
            <li>
              For inbound chats: Meta cannot call <code className="rounded bg-secondary px-1">localhost</code>.
              Use a public HTTPS tunnel (ngrok / Cloudflare Tunnel), set{" "}
              <code className="rounded bg-secondary px-1">VITE_APP_URL</code> to that HTTPS URL, restart
              the app, then in Meta Webhooks set Callback URL to the URL below and the same Verify
              Token. Subscribe to <code className="rounded bg-secondary px-1">messages</code>.
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
            <Button
              size="sm"
              variant="secondary"
              disabled={!waSetupQuery.data?.configured || testWaMutation.isPending}
              onClick={() => testWaMutation.mutate()}
            >
              {testWaMutation.isPending ? "Testing…" : "Test connection"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Status:{" "}
            {waSetupQuery.data?.configured
              ? `Credentials saved${waSetupQuery.data.displayPhone ? ` · ${waSetupQuery.data.displayPhone}` : ""}${
                  waSetupQuery.data.hasWaba ? " · WABA set" : " · add WABA for Broadcasting"
                }.${
                  waSetupQuery.data.needsPublicHttps
                    ? " Inbound webhooks need a public HTTPS URL (not localhost)."
                    : " Send a WhatsApp message to your business number → should appear in Inbox."
                }`
              : "Not configured yet — use Configure WhatsApp."}
          </p>
        </Panel>

        <div
          id="gmail-oauth"
          className="rounded-xl border border-primary/30 bg-primary/5 p-4"
        >
          <p className="text-sm font-semibold text-foreground">Gmail OAuth (n8n-style) — setup here</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Save Google Client ID + Secret, then Connect with Google. Used for Send Gmail popup and email
            broadcasting.
          </p>
        </div>

        <Panel
          title="Gmail (OAuth — like n8n)"
          description="Connect a Google account with Client ID + Secret, then Sign in with Google. Used for Send Gmail popup and email broadcasting."
        >
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Google Cloud → create OAuth Client (Web) → enable <strong>Gmail API</strong>.
            </li>
            <li>
              Add authorized redirect URI exactly:{" "}
              <code className="rounded bg-secondary px-1 text-[11px]">
                {gmailSetupQuery.data?.redirectUri || `${appUrl}/api/oauth/gmail/callback`}
              </code>
            </li>
            <li>Save Client ID + Client Secret here (same idea as n8n Gmail credentials).</li>
            <li>Click <strong>Connect with Google</strong> and approve Gmail send access.</li>
          </ol>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Pill
              tone={
                gmailSetupQuery.data?.connected
                  ? "success"
                  : gmailSetupQuery.data?.credentialsConfigured
                    ? "warning"
                    : "neutral"
              }
              dot
            >
              {gmailSetupQuery.data?.connected
                ? `Connected · ${gmailSetupQuery.data.email}`
                : gmailSetupQuery.data?.credentialsConfigured
                  ? "Credentials saved — connect Google"
                  : "Credentials not saved"}
            </Pill>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setGmailCredOpen(true)}>
              {gmailSetupQuery.data?.credentialsConfigured ? "Edit OAuth credentials" : "Set OAuth credentials"}
            </Button>
            <Button
              size="sm"
              disabled={!gmailSetupQuery.data?.credentialsConfigured || connectGmailMutation.isPending}
              onClick={() => connectGmailMutation.mutate()}
            >
              {connectGmailMutation.isPending ? "Redirecting…" : "Connect with Google"}
            </Button>
            {gmailSetupQuery.data?.connected ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={disconnectGmailMutation.isPending}
                onClick={() => disconnectGmailMutation.mutate()}
              >
                Disconnect Gmail
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const uri = gmailSetupQuery.data?.redirectUri || "";
                if (!uri) return;
                await navigator.clipboard.writeText(uri);
                toast.success("Redirect URI copied");
              }}
            >
              <Copy className="size-3.5" /> Copy redirect URI
            </Button>
          </div>
        </Panel>

        <Panel
          title="Email (SMTP + inbound webhook)"
          description="Optional SMTP fallback for outbound. Forward inbound mail to the webhook so threads appear in Inbox. Prefer Gmail OAuth above for marketing sends."
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
              Click <span className="font-medium text-foreground">Sync leads now</span> for the latest window
              (max 7 days), or use <span className="font-medium text-foreground">Historical backfill</span> below
              for older ranges (≤365 days, chunked every 5 min). IndiaMART allows{" "}
              <strong>1 Pull every 5 minutes</strong>.
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
              disabled={
                !imSetupQuery.data?.configured ||
                syncImMutation.isPending ||
                (imSetupQuery.data?.cooldownMs ?? 0) > 0 ||
                imSetupQuery.data?.backfill?.status === "running" ||
                imSetupQuery.data?.backfill?.status === "waiting"
              }
              onClick={() => syncImMutation.mutate()}
            >
              {syncImMutation.isPending
                ? "Syncing…"
                : imSetupQuery.data?.backfill?.status === "running" ||
                    imSetupQuery.data?.backfill?.status === "waiting"
                  ? "Backfill running…"
                  : (imSetupQuery.data?.cooldownMs ?? 0) > 0
                    ? `Wait ${Math.ceil((imSetupQuery.data?.cooldownMs ?? 0) / 60_000)} min`
                    : "Sync leads now"}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/leads">Open leads</Link>
            </Button>
          </div>
          <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Auto lead sync</p>
                <p className="text-xs text-muted-foreground">
                  {describeAutoSync({
                    auto_sync_enabled: imSetupQuery.data?.autoSyncEnabled,
                    auto_sync_schedule: imSetupQuery.data?.autoSyncSchedule,
                    auto_sync_daily_time: imSetupQuery.data?.autoSyncDailyTime,
                  })}
                  {imSetupQuery.data?.lastAutoSyncAt
                    ? ` · Last auto ${new Date(imSetupQuery.data.lastAutoSyncAt).toLocaleString()}`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="im-auto-sync" className="text-sm font-medium">
                  {imSetupQuery.data?.autoSyncEnabled ? "On" : "Off"}
                </Label>
                <Switch
                  id="im-auto-sync"
                  checked={Boolean(imSetupQuery.data?.autoSyncEnabled)}
                  disabled={
                    !imSetupQuery.data?.configured || imAutoSyncMutation.isPending
                  }
                  onCheckedChange={(enabled) =>
                    imAutoSyncMutation.mutate({
                      enabled,
                      schedule: imSetupQuery.data?.autoSyncSchedule || "every_6h",
                      dailyTime: imSetupQuery.data?.autoSyncDailyTime || "18:00",
                    })
                  }
                />
              </div>
            </div>
            {imSetupQuery.data?.autoSyncEnabled ? (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Schedule</Label>
                  <Select
                    value={imSetupQuery.data?.autoSyncSchedule || "every_6h"}
                    onValueChange={(value: AutoSyncSchedule) =>
                      imAutoSyncMutation.mutate({
                        enabled: true,
                        schedule: value,
                        dailyTime: imSetupQuery.data?.autoSyncDailyTime || "18:00",
                      })
                    }
                  >
                    <SelectTrigger className="w-[11rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUTO_SYNC_SCHEDULE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(imSetupQuery.data?.autoSyncSchedule || "every_6h") === "daily_at" ? (
                  <div className="space-y-1">
                    <Label className="text-xs">Time (IST)</Label>
                    <Select
                      value={imSetupQuery.data?.autoSyncDailyTime || "18:00"}
                      onValueChange={(dailyTime) =>
                        imAutoSyncMutation.mutate({
                          enabled: true,
                          schedule: "daily_at",
                          dailyTime,
                        })
                      }
                    >
                      <SelectTrigger className="w-[11rem]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AUTO_SYNC_DAILY_TIME_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Toggle off = manual only. Use <span className="font-medium text-foreground">Sync leads now</span>{" "}
                when you want to pull.
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Status:{" "}
            {imSetupQuery.data?.channelError
              ? imSetupQuery.data.channelError
              : indiamart
                ? imSetupQuery.data?.configured
                  ? imSetupQuery.data.lastSyncAt
                    ? `CRM key saved. Last sync ${new Date(imSetupQuery.data.lastSyncAt).toLocaleString()}.${
                        (imSetupQuery.data.cooldownMs ?? 0) > 0
                          ? ` Next sync in ~${Math.ceil((imSetupQuery.data.cooldownMs ?? 0) / 60_000)} min.`
                          : ""
                      }`
                    : "CRM key saved — run Sync leads now to import enquiries (max once / 5 min)."
                  : "Channel card ready — click Configure IndiaMART and paste your CRM key."
                : "IndiaMART card missing from the grid. Click Create IndiaMART card (requires migration 007)."}
          </p>

          <div className="mt-4 rounded-lg border border-border/80 bg-secondary/30 p-3">
            <p className="mb-2 text-sm font-medium text-foreground">Historical backfill</p>
            <p className="mb-3 text-xs text-muted-foreground">
              IndiaMART allows up to <strong>7 days per pull</strong> and{" "}
              <strong>1 pull / 5 minutes</strong>. History is available for about{" "}
              <strong>365 days</strong>. Pick a range — we split into 7-day chunks and wait between
              API hits.
            </p>
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="im-bf-from" className="text-xs">
                  From
                </Label>
                <Input
                  id="im-bf-from"
                  type="date"
                  className="w-[11rem]"
                  min={imSetupQuery.data?.backfillEarliestDate}
                  max={imSetupQuery.data?.backfillLatestDate}
                  value={imBackfillFrom}
                  disabled={
                    !imSetupQuery.data?.configured ||
                    imSetupQuery.data?.backfill?.status === "running" ||
                    imSetupQuery.data?.backfill?.status === "waiting"
                  }
                  onChange={(e) => setImBackfillFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="im-bf-to" className="text-xs">
                  To
                </Label>
                <Input
                  id="im-bf-to"
                  type="date"
                  className="w-[11rem]"
                  min={imSetupQuery.data?.backfillEarliestDate}
                  max={imSetupQuery.data?.backfillLatestDate}
                  value={imBackfillTo}
                  disabled={
                    !imSetupQuery.data?.configured ||
                    imSetupQuery.data?.backfill?.status === "running" ||
                    imSetupQuery.data?.backfill?.status === "waiting"
                  }
                  onChange={(e) => setImBackfillTo(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                disabled={
                  !imSetupQuery.data?.configured ||
                  !imBackfillFrom ||
                  !imBackfillTo ||
                  startImBackfillMutation.isPending ||
                  imSetupQuery.data?.backfill?.status === "running" ||
                  imSetupQuery.data?.backfill?.status === "waiting"
                }
                onClick={() => startImBackfillMutation.mutate()}
              >
                {startImBackfillMutation.isPending ? "Starting…" : "Start backfill"}
              </Button>
              {(imSetupQuery.data?.backfill?.status === "running" ||
                imSetupQuery.data?.backfill?.status === "waiting") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cancelImBackfillMutation.isPending}
                  onClick={() => cancelImBackfillMutation.mutate()}
                >
                  {cancelImBackfillMutation.isPending ? "Cancelling…" : "Cancel"}
                </Button>
              )}
            </div>
            {imSetupQuery.data?.backfill ? (
              <p className="text-xs text-muted-foreground">
                {imSetupQuery.data.backfill.status === "running" ||
                imSetupQuery.data.backfill.status === "waiting"
                  ? `In progress: chunk ${imSetupQuery.data.backfill.chunksDone}/${imSetupQuery.data.backfill.chunksTotal} · +${imSetupQuery.data.backfill.created} leads · ${imSetupQuery.data.backfill.fetched} fetched.${
                      imSetupQuery.data.backfill.nextChunkAt
                        ? ` Next chunk ~${new Date(imSetupQuery.data.backfill.nextChunkAt).toLocaleTimeString()}.`
                        : ""
                    } Keep this page open or leave cron running every 5 min.`
                  : imSetupQuery.data.backfill.status === "done"
                    ? `Last backfill complete: +${imSetupQuery.data.backfill.created} leads · ${imSetupQuery.data.backfill.chunksDone} chunks.`
                    : imSetupQuery.data.backfill.status === "error"
                      ? `Backfill error: ${imSetupQuery.data.backfill.lastError || "failed"}`
                      : imSetupQuery.data.backfill.status === "cancelled"
                        ? `Backfill cancelled at chunk ${imSetupQuery.data.backfill.chunksDone}/${imSetupQuery.data.backfill.chunksTotal} (+${imSetupQuery.data.backfill.created} leads).`
                        : null}
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="TradeIndia (My Inquiry API)"
          description="Pull buyer inquiries into master Leads + Inbox for follow-up and remarketing."
        >
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              TradeIndia → Dashboard → Inquiries &amp; Contacts →{" "}
              <span className="font-medium text-foreground">My Inquiry API</span> — copy userid,
              profile_id, and key.
            </li>
            <li>Configure TradeIndia below (credentials are stored on the channel, not in git).</li>
            <li>
              <span className="font-medium text-foreground">Sync leads now</span> pulls the last{" "}
              <strong>24 hours</strong>, or use <span className="font-medium text-foreground">Historical backfill</span>{" "}
              below (one calendar day per pull, ~1 min between days). Leads get source{" "}
              <span className="font-medium text-foreground">tradeindia</span> plus Inbox threads.
            </li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            {tradeindia ? (
              <Button size="sm" onClick={() => openEdit(tradeindia)}>
                Configure TradeIndia
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={ensureTiMutation.isPending}
                onClick={() => ensureTiMutation.mutate()}
              >
                {ensureTiMutation.isPending ? "Creating…" : "Create TradeIndia card"}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={
                !tiSetupQuery.data?.configured ||
                syncTiMutation.isPending ||
                tiSetupQuery.data?.backfill?.status === "running" ||
                tiSetupQuery.data?.backfill?.status === "waiting"
              }
              onClick={() => syncTiMutation.mutate()}
            >
              {syncTiMutation.isPending
                ? "Syncing…"
                : tiSetupQuery.data?.backfill?.status === "running" ||
                    tiSetupQuery.data?.backfill?.status === "waiting"
                  ? "Backfill running…"
                  : "Sync leads now"}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/leads">Open leads</Link>
            </Button>
          </div>
          <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Auto lead sync</p>
                <p className="text-xs text-muted-foreground">
                  {describeAutoSync({
                    auto_sync_enabled: tiSetupQuery.data?.autoSyncEnabled,
                    auto_sync_schedule: tiSetupQuery.data?.autoSyncSchedule,
                    auto_sync_daily_time: tiSetupQuery.data?.autoSyncDailyTime,
                  })}
                  {tiSetupQuery.data?.lastAutoSyncAt
                    ? ` · Last auto ${new Date(tiSetupQuery.data.lastAutoSyncAt).toLocaleString()}`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="ti-auto-sync" className="text-sm font-medium">
                  {tiSetupQuery.data?.autoSyncEnabled ? "On" : "Off"}
                </Label>
                <Switch
                  id="ti-auto-sync"
                  checked={Boolean(tiSetupQuery.data?.autoSyncEnabled)}
                  disabled={
                    !tiSetupQuery.data?.configured || tiAutoSyncMutation.isPending
                  }
                  onCheckedChange={(enabled) =>
                    tiAutoSyncMutation.mutate({
                      enabled,
                      schedule: tiSetupQuery.data?.autoSyncSchedule || "every_6h",
                      dailyTime: tiSetupQuery.data?.autoSyncDailyTime || "18:00",
                    })
                  }
                />
              </div>
            </div>
            {tiSetupQuery.data?.autoSyncEnabled ? (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Schedule</Label>
                  <Select
                    value={tiSetupQuery.data?.autoSyncSchedule || "every_6h"}
                    onValueChange={(value: AutoSyncSchedule) =>
                      tiAutoSyncMutation.mutate({
                        enabled: true,
                        schedule: value,
                        dailyTime: tiSetupQuery.data?.autoSyncDailyTime || "18:00",
                      })
                    }
                  >
                    <SelectTrigger className="w-[11rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUTO_SYNC_SCHEDULE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(tiSetupQuery.data?.autoSyncSchedule || "every_6h") === "daily_at" ? (
                  <div className="space-y-1">
                    <Label className="text-xs">Time (IST)</Label>
                    <Select
                      value={tiSetupQuery.data?.autoSyncDailyTime || "18:00"}
                      onValueChange={(dailyTime) =>
                        tiAutoSyncMutation.mutate({
                          enabled: true,
                          schedule: "daily_at",
                          dailyTime,
                        })
                      }
                    >
                      <SelectTrigger className="w-[11rem]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AUTO_SYNC_DAILY_TIME_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Toggle off = manual only. Use <span className="font-medium text-foreground">Sync leads now</span>{" "}
                when you want to pull.
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Status:{" "}
            {tradeindia
              ? tiSetupQuery.data?.configured
                ? tiSetupQuery.data.lastSyncAt
                  ? `Credentials saved. Last sync ${new Date(tiSetupQuery.data.lastSyncAt).toLocaleString()}.`
                  : "Credentials saved — run Sync leads now to import inquiries."
                : "Channel card ready — click Configure TradeIndia and paste userid / profile_id / key."
              : "TradeIndia card missing. Click Create TradeIndia card (requires migration 014 + 014b)."}
          </p>

          <div className="mt-4 rounded-lg border border-border/80 bg-secondary/30 p-3">
            <p className="mb-2 text-sm font-medium text-foreground">Historical backfill</p>
            <p className="mb-3 text-xs text-muted-foreground">
              TradeIndia allows only <strong>24 hours per pull</strong>. We pull{" "}
              <strong>one calendar day at a time</strong> (~1 minute between days). Pick a range within
              about the last 365 days — very old dates may be rejected by their API.
            </p>
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="ti-bf-from" className="text-xs">
                  From
                </Label>
                <Input
                  id="ti-bf-from"
                  type="date"
                  className="w-[11rem]"
                  min={tiSetupQuery.data?.backfillEarliestDate}
                  max={tiSetupQuery.data?.backfillLatestDate}
                  value={tiBackfillFrom}
                  disabled={
                    !tiSetupQuery.data?.configured ||
                    tiSetupQuery.data?.backfill?.status === "running" ||
                    tiSetupQuery.data?.backfill?.status === "waiting"
                  }
                  onChange={(e) => setTiBackfillFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ti-bf-to" className="text-xs">
                  To
                </Label>
                <Input
                  id="ti-bf-to"
                  type="date"
                  className="w-[11rem]"
                  min={tiSetupQuery.data?.backfillEarliestDate}
                  max={tiSetupQuery.data?.backfillLatestDate}
                  value={tiBackfillTo}
                  disabled={
                    !tiSetupQuery.data?.configured ||
                    tiSetupQuery.data?.backfill?.status === "running" ||
                    tiSetupQuery.data?.backfill?.status === "waiting"
                  }
                  onChange={(e) => setTiBackfillTo(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                disabled={
                  !tiSetupQuery.data?.configured ||
                  !tiBackfillFrom ||
                  !tiBackfillTo ||
                  startTiBackfillMutation.isPending ||
                  tiSetupQuery.data?.backfill?.status === "running" ||
                  tiSetupQuery.data?.backfill?.status === "waiting"
                }
                onClick={() => startTiBackfillMutation.mutate()}
              >
                {startTiBackfillMutation.isPending ? "Starting…" : "Start backfill"}
              </Button>
              {(tiSetupQuery.data?.backfill?.status === "running" ||
                tiSetupQuery.data?.backfill?.status === "waiting") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cancelTiBackfillMutation.isPending}
                  onClick={() => cancelTiBackfillMutation.mutate()}
                >
                  {cancelTiBackfillMutation.isPending ? "Cancelling…" : "Cancel"}
                </Button>
              )}
            </div>
            {tiSetupQuery.data?.backfill ? (
              <p className="text-xs text-muted-foreground">
                {tiSetupQuery.data.backfill.status === "running" ||
                tiSetupQuery.data.backfill.status === "waiting"
                  ? `In progress: day ${tiSetupQuery.data.backfill.chunksDone}/${tiSetupQuery.data.backfill.chunksTotal} · +${tiSetupQuery.data.backfill.created} leads · ${tiSetupQuery.data.backfill.fetched} fetched.${
                      tiSetupQuery.data.backfill.nextChunkAt
                        ? ` Next day ~${new Date(tiSetupQuery.data.backfill.nextChunkAt).toLocaleTimeString()}.`
                        : ""
                    } Keep this page open or leave cron running.`
                  : tiSetupQuery.data.backfill.status === "done"
                    ? `Last backfill complete: +${tiSetupQuery.data.backfill.created} leads · ${tiSetupQuery.data.backfill.chunksDone} days.`
                    : tiSetupQuery.data.backfill.status === "error"
                      ? `Backfill error: ${tiSetupQuery.data.backfill.lastError || "failed"}`
                      : tiSetupQuery.data.backfill.status === "cancelled"
                        ? `Backfill cancelled at day ${tiSetupQuery.data.backfill.chunksDone}/${tiSetupQuery.data.backfill.chunksTotal} (+${tiSetupQuery.data.backfill.created} leads).`
                        : null}
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="Brainmine CRM+ (lead sync + follow-up write-back)"
          description="Pull leads from Brainmine into Engage. Separately, manually write conversation follow-ups back to Brainmine Follow Up table."
        >
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Ask Brainmine for API base URL + API key (and secret if ERPNext-style token auth).</li>
            <li>
              Configure below. Defaults assume ERPNext Lead API (
              <code className="text-xs">/api/resource/Lead</code>). Change path/auth when docs arrive.
            </li>
            <li>
              <span className="font-medium text-foreground">Sync leads now</span> pulls only the{" "}
              <strong>latest updated</strong> leads (max 20) — no full dump, duplicates upserted.
              Use <span className="font-medium text-foreground">Date range</span> below for historical
              backfill.
            </li>
            <li>
              Upserts into{" "}
              <Link className="text-primary underline" to="/leads">
                /leads
              </Link>{" "}
              with source <span className="font-medium text-foreground">brainmine</span>. Lead{" "}
              <strong>sync stays read-only</strong>.
            </li>
            <li>
              <span className="font-medium text-foreground">Write follow-ups to Brainmine</span> is a{" "}
              <strong>separate</strong> path: matches CRM id, builds a conversation summary, appends one
              Follow Up row (type=<code>Whatsapp</code>; Contact matched phone→email→company→name; next
              date=+4 days, description=summary). Only WhatsApp conversations are written. Manual only —
              run once per day when ready. If write-back fails on child table name, use{" "}
              <span className="font-medium text-foreground">Inspect write-back fields</span>, Save
              mapping, then retry.
            </li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            {brainmine ? (
              <Button size="sm" onClick={() => openEdit(brainmine)}>
                Configure Brainmine
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={ensureBmMutation.isPending}
                onClick={() => ensureBmMutation.mutate()}
              >
                {ensureBmMutation.isPending ? "Creating…" : "Create Brainmine card"}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={!bmSetupQuery.data?.configured || syncBmMutation.isPending}
              onClick={() => syncBmMutation.mutate(undefined)}
            >
              {syncBmMutation.isPending ? "Syncing…" : "Sync leads now"}
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={
                !bmSetupQuery.data?.configured ||
                writebackBmMutation.isPending ||
                syncBmMutation.isPending
              }
              onClick={() => writebackBmMutation.mutate()}
              title="Append conversation summaries to Brainmine Follow Up table (does not change lead sync)"
            >
              {writebackBmMutation.isPending ? "Writing…" : "Write follow-ups to Brainmine"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!bmSetupQuery.data?.configured || inspectBmMutation.isPending}
              onClick={() => inspectBmMutation.mutate()}
            >
              {inspectBmMutation.isPending ? "Inspecting…" : "Inspect CRM fields"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!bmSetupQuery.data?.configured || inspectWbMutation.isPending}
              onClick={() => inspectWbMutation.mutate()}
              title="Discover Follow Up child table fieldnames for write-back"
            >
              {inspectWbMutation.isPending ? "Inspecting…" : "Inspect write-back fields"}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/leads">Open leads</Link>
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Status:{" "}
            {brainmine
              ? bmSetupQuery.data?.configured
                ? bmSetupQuery.data.lastSyncAt
                  ? `Connected. Last manual/range sync ${new Date(bmSetupQuery.data.lastSyncAt).toLocaleString()}.`
                  : "Credentials saved — run Sync leads now or a date range."
                : "Channel card ready — click Configure Brainmine."
              : "Brainmine card missing. Click Create Brainmine card (requires migration 011 + 011b)."}
          </p>
          {bmSetupQuery.data?.lastWritebackAt || bmSetupQuery.data?.lastWritebackResult ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Last follow-up write-back:{" "}
              {bmSetupQuery.data.lastWritebackAt
                ? new Date(bmSetupQuery.data.lastWritebackAt).toLocaleString()
                : "—"}
              {bmSetupQuery.data.lastWritebackResult
                ? ` · ${bmSetupQuery.data.lastWritebackResult}`
                : ""}
            </p>
          ) : null}

          <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Auto lead sync</p>
                <p className="text-xs text-muted-foreground">
                  {bmSetupQuery.data?.autoSyncDescription ||
                    "Auto sync off — use Sync leads now"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="bm-auto-sync" className="text-sm font-medium">
                  {bmAutoEnabled ? "On" : "Off"}
                </Label>
                <Switch
                  id="bm-auto-sync"
                  checked={bmAutoEnabled}
                  disabled={!bmSetupQuery.data?.configured || bmAutoSyncMutation.isPending}
                  onCheckedChange={(enabled) => setBmAutoEnabled(enabled)}
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Fetches only the <strong>latest updated</strong> leads (max 20), upserts so nothing
              duplicates. Not a historical backfill — use Date range below for that.
            </p>
            <div className="mt-3 space-y-1 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Last auto sync:</span>{" "}
                {bmSetupQuery.data?.lastAutoSyncAt
                  ? new Date(bmSetupQuery.data.lastAutoSyncAt).toLocaleString()
                  : "Never (waiting for first cron or Run now)"}
              </p>
              <p>
                <span className="font-medium text-foreground">Next due:</span>{" "}
                {bmSetupQuery.data?.autoSyncEnabled
                  ? bmSetupQuery.data.nextAutoSyncDueAt
                    ? new Date(bmSetupQuery.data.nextAutoSyncDueAt).toLocaleString()
                    : "—"
                  : "Off"}
              </p>
              <p>
                <span className="font-medium text-foreground">Last cron check:</span>{" "}
                {bmSetupQuery.data?.lastAutoSyncAttemptAt
                  ? new Date(bmSetupQuery.data.lastAutoSyncAttemptAt).toLocaleString()
                  : "No cron hit yet — check Render Cron CRON_URL / CRON_SECRET"}
              </p>
              <p>
                <span className="font-medium text-foreground">Result:</span>{" "}
                {bmSetupQuery.data?.lastAutoSyncResult || "—"}
              </p>
              {bmSetupQuery.data?.lastAutoSyncError ? (
                <p className="text-destructive">
                  <span className="font-medium">Error:</span> {bmSetupQuery.data.lastAutoSyncError}
                </p>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Every</Label>
                <Input
                  type="number"
                  min={1}
                  className="h-9 w-[5.5rem]"
                  value={bmIntervalValue}
                  disabled={!bmSetupQuery.data?.configured || bmAutoSyncMutation.isPending}
                  onChange={(e) => setBmIntervalValue(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unit</Label>
                <Select
                  value={bmIntervalUnit}
                  onValueChange={(v: BrainmineIntervalUnit) => setBmIntervalUnit(v)}
                  disabled={!bmSetupQuery.data?.configured || bmAutoSyncMutation.isPending}
                >
                  <SelectTrigger className="w-[8.5rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sec">Seconds</SelectItem>
                    <SelectItem value="min">Minutes</SelectItem>
                    <SelectItem value="hr">Hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                disabled={
                  !bmSetupQuery.data?.configured ||
                  bmAutoSyncMutation.isPending ||
                  !Number(bmIntervalValue)
                }
                onClick={() =>
                  bmAutoSyncMutation.mutate({
                    enabled: bmAutoEnabled,
                    intervalValue: Math.max(1, Math.floor(Number(bmIntervalValue) || 1)),
                    intervalUnit: bmIntervalUnit,
                  })
                }
              >
                {bmAutoSyncMutation.isPending ? "Saving…" : "Save schedule"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={
                  !bmSetupQuery.data?.configured ||
                  !bmSetupQuery.data?.autoSyncEnabled ||
                  bmRunAutoNowMutation.isPending ||
                  bmAutoSyncMutation.isPending
                }
                onClick={() => bmRunAutoNowMutation.mutate()}
              >
                {bmRunAutoNowMutation.isPending ? "Running…" : "Run auto sync now"}
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Default: <strong>On</strong>, every <strong>5 minutes</strong> when Brainmine is
              configured (matches Render Cron). Hits{" "}
              <code className="text-[10px]">/api/cron/automations</code>. If “Last cron check” never
              updates, fix Cron env:{" "}
              <code className="text-[10px]">CRON_URL</code> = this app’s{" "}
              <code className="text-[10px]">…/api/cron/automations</code> and matching{" "}
              <code className="text-[10px]">CRON_SECRET</code>. Seconds minimum is 60 after save.
            </p>
          </div>

          <div className="mt-4 rounded-lg border border-border/80 bg-secondary/30 p-3">
            <p className="mb-2 text-sm font-medium text-foreground">Date-wise lead extraction</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Historical backfill: leads <strong>created</strong> in Brainmine between two dates
              (ERPNext <code className="text-[10px]">creation</code> filter). Max{" "}
              <strong>365 days</strong> per run. Page size follows Configure → Leads per sync.
              For day-to-day use, prefer <span className="font-medium text-foreground">Sync leads now</span>{" "}
              (latest ≤20 only).
            </p>
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="bm-range-from" className="text-xs">
                  From
                </Label>
                <Input
                  id="bm-range-from"
                  type="date"
                  className="w-[11rem]"
                  min={bmSetupQuery.data?.rangeEarliestDate}
                  max={bmSetupQuery.data?.rangeLatestDate}
                  value={bmRangeFrom}
                  disabled={!bmSetupQuery.data?.configured || syncBmMutation.isPending}
                  onChange={(e) => setBmRangeFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bm-range-to" className="text-xs">
                  To
                </Label>
                <Input
                  id="bm-range-to"
                  type="date"
                  className="w-[11rem]"
                  min={bmSetupQuery.data?.rangeEarliestDate}
                  max={bmSetupQuery.data?.rangeLatestDate}
                  value={bmRangeTo}
                  disabled={!bmSetupQuery.data?.configured || syncBmMutation.isPending}
                  onChange={(e) => setBmRangeTo(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                disabled={
                  !bmSetupQuery.data?.configured ||
                  !bmRangeFrom ||
                  !bmRangeTo ||
                  syncBmMutation.isPending
                }
                onClick={() =>
                  syncBmMutation.mutate({ from: bmRangeFrom, to: bmRangeTo })
                }
              >
                {syncBmMutation.isPending ? "Pulling…" : "Pull date range"}
              </Button>
            </div>
          </div>
        </Panel>

        <Panel
          title="WordPress / WooCommerce (product catalog)"
          description="WordPress is the catalog master. Pull published Woo products into Engage /products for WhatsApp and AI cards. Files stay on WP as public HTTPS URLs."
        >
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Default site:{" "}
              <code className="text-xs">{WORDPRESS_DEFAULT_SITE}</code>. Woo Store API is public —
              Inspect works before keys.
            </li>
            <li>
              Optional: WooCommerce → Settings → Advanced → REST API → add a Read key. Paste
              Consumer Key + Secret below for prices, descriptions, and download PDFs.
            </li>
            <li>
              <span className="font-medium text-foreground">Inspect</span> samples names, photos, SKU
              coverage, and catalogue PDFs.{" "}
              <span className="font-medium text-foreground">Sync now</span> upserts by SKU (or{" "}
              <code className="text-xs">WOO-{"{id}"}</code> / slug when SKU is empty). Sale price
              wins over regular. Unpublished Woo products are marked inactive — manual Engage rows
              are left alone.
            </li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            {wordpress ? (
              <Button size="sm" onClick={() => openEdit(wordpress)}>
                Configure WordPress
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={ensureWpMutation.isPending}
                onClick={() => ensureWpMutation.mutate()}
              >
                {ensureWpMutation.isPending ? "Creating…" : "Create WordPress card"}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={inspectWpMutation.isPending}
              onClick={() => inspectWpMutation.mutate()}
            >
              {inspectWpMutation.isPending ? "Inspecting…" : "Inspect catalog"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!wpSetupQuery.data?.configured || syncWpMutation.isPending}
              onClick={() => syncWpMutation.mutate()}
            >
              {syncWpMutation.isPending ? "Syncing…" : "Sync now"}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/products">Open products</Link>
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Status:{" "}
            {wordpress
              ? wpSetupQuery.data?.configured
                ? wpSetupQuery.data.lastSyncAt
                  ? `Connected. Last sync ${new Date(wpSetupQuery.data.lastSyncAt).toLocaleString()}${
                      wpSetupQuery.data.lastSyncResult ? ` · ${wpSetupQuery.data.lastSyncResult}` : ""
                    }.`
                  : wpSetupQuery.data.hasKeys
                    ? "REST keys saved — run Inspect, then Sync now."
                    : "Site URL ready. Inspect works now; add REST keys later for prices and PDFs."
                : "Channel card ready — click Configure WordPress."
              : "WordPress card missing. Click Create WordPress card (requires migration 034 + 034b)."}
          </p>
          {wpSetupQuery.data?.lastSyncError ? (
            <p className="mt-1 text-xs text-destructive">{wpSetupQuery.data.lastSyncError}</p>
          ) : null}
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
                <Panel key={c.id} className="overflow-hidden" bodyClassName="relative overflow-hidden p-4">
              <div
                className="absolute inset-y-0 left-0 w-1"
                style={{ background: getChannelBrand(c.type).accent }}
                aria-hidden
              />
              <div className="flex items-start gap-3 pl-1">
                    <ChannelBrandMark channel={c.type} size="md" />
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
                                : c.type === "tradeindia"
                                  ? "Inquiry API"
                                  : c.type === "brainmine"
                                  ? "CRM sync"
                                  : c.type === "wordpress"
                                    ? "Woo catalog"
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
            <li>
              <span className="font-medium text-foreground">TradeIndia</span> — My Inquiry API pull → Leads + Inbox follow-up.
            </li>
            <li>
              <span className="font-medium text-foreground">WordPress / WooCommerce</span> — pull-only product catalog into /products (WP is source of truth).
            </li>
          </ul>
        </Panel>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              {editing ? <ChannelBrandMark channel={editing.type} size="md" /> : null}
              Configure {editing?.name}
            </DialogTitle>
            <DialogDescription>
              {editing?.type === "whatsapp"
                ? "Paste Meta WhatsApp Cloud API credentials. Inbound messages will create Inbox conversations."
                : editing?.type === "email"
                  ? "Enter SMTP credentials for outbound replies. Point inbound mail at the webhook URL on this page."
                  : editing?.type === "facebook" || editing?.type === "instagram"
                    ? "Paste Facebook Page ID and Page access token. Inbound DMs create Inbox conversations."
                    : editing?.type === "indiamart"
                      ? "Paste your IndiaMART Lead Manager CRM key. Sync pulls enquiries into Leads for remarketing."
                      : editing?.type === "tradeindia"
                        ? "Paste TradeIndia My Inquiry API userid, profile_id, and key. Sync pulls inquiries into Leads + Inbox."
                        : editing?.type === "brainmine"
                          ? "Connect Brainmine CRM+ (read-only). Sync pulls leads into the master Leads sheet."
                          : editing?.type === "wordpress"
                            ? "WordPress is the catalog master. Save the site URL now; add Woo REST keys later for prices and download PDFs."
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
                <Label htmlFor="wa-waba">WhatsApp Business Account ID (required for templates / broadcasting)</Label>
                <Input
                  id="wa-waba"
                  value={waBusinessAccountId}
                  onChange={(e) => setWaBusinessAccountId(e.target.value)}
                  placeholder="WABA ID from Meta → WhatsApp → API Setup (not Phone Number ID)"
                />
                <p className="text-xs text-muted-foreground">
                  Different from Phone Number ID. Templates sync fails if this field is empty or set to the phone ID.
                </p>
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
          ) : editing?.type === "tradeindia" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="ti-userid">User ID</Label>
                <Input
                  id="ti-userid"
                  value={tiUserid}
                  onChange={(e) => setTiUserid(e.target.value)}
                  placeholder="From My Inquiry API"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ti-profile">Profile ID</Label>
                <Input
                  id="ti-profile"
                  value={tiProfileId}
                  onChange={(e) => setTiProfileId(e.target.value)}
                  placeholder="From My Inquiry API"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ti-key">API key</Label>
                <Input
                  id="ti-key"
                  type="password"
                  value={tiKey}
                  onChange={(e) => setTiKey(e.target.value)}
                  placeholder={
                    (editing.config as { key?: string } | null)?.key
                      ? "Leave blank to keep existing key"
                      : "From My Inquiry API"
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Endpoint:{" "}
                <span className="font-medium text-foreground">
                  tradeindia.com/utils/my_inquiry.html
                </span>
                . After saving, use <span className="font-medium text-foreground">Sync leads now</span>.
              </p>
            </div>
          ) : editing?.type === "brainmine" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="bm-base">API base URL</Label>
                <Input
                  id="bm-base"
                  value={bmApiBaseUrl}
                  onChange={(e) => setBmApiBaseUrl(e.target.value)}
                  placeholder="https://brainmineai.in"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bm-key">API key</Label>
                <Input
                  id="bm-key"
                  type="password"
                  value={bmApiKey}
                  onChange={(e) => setBmApiKey(e.target.value)}
                  placeholder={
                    bmSetupQuery.data?.hasKey
                      ? "Leave blank to keep existing / .env key"
                      : "API key"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bm-secret">API secret (token auth)</Label>
                <Input
                  id="bm-secret"
                  type="password"
                  value={bmApiSecret}
                  onChange={(e) => setBmApiSecret(e.target.value)}
                  placeholder={
                    bmSetupQuery.data?.hasSecret
                      ? "Leave blank to keep existing / .env secret"
                      : "ERPNext-style api_secret"
                  }
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Auth style</Label>
                  <Select
                    value={bmAuthStyle}
                    onValueChange={(v: BrainmineAuthStyle) => setBmAuthStyle(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="token">token key:secret (ERPNext)</SelectItem>
                      <SelectItem value="bearer">Bearer token</SelectItem>
                      <SelectItem value="x-api-key">X-API-Key header</SelectItem>
                      <SelectItem value="query">Query param</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bm-path">Leads path</Label>
                  <Input
                    id="bm-path"
                    value={bmLeadsPath}
                    onChange={(e) => setBmLeadsPath(e.target.value)}
                    placeholder="/api/resource/Lead"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Leads per sync (date range)</Label>
                <Select value={bmSyncLimit} onValueChange={setBmSyncLimit}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["10", "20", "30", "50", "100", "200"].map((n) => (
                      <SelectItem key={n} value={n}>
                        {n} leads / page
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Used only for date-range backfill. <strong>Sync leads now</strong> always takes the
                  latest ≤20 updated leads.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Values here override{" "}
                <code className="text-[10px]">BRAINMINE_*</code> in{" "}
                <code className="text-[10px]">.env</code> / Render. Default base:{" "}
                <code className="text-[10px]">https://brainmineai.in</code>. If Lead
                list is empty, try{" "}
                <code className="text-[10px]">/api/resource/Opportunity</code>.
                {bmSetupQuery.data?.fromEnv?.key || bmSetupQuery.data?.fromEnv?.baseUrl
                  ? " Env credentials detected."
                  : null}
              </p>
            </div>
          ) : editing?.type === "wordpress" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="wp-site">Site URL</Label>
                <Input
                  id="wp-site"
                  value={wpSiteUrl}
                  onChange={(e) => setWpSiteUrl(e.target.value)}
                  placeholder={WORDPRESS_DEFAULT_SITE}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wp-ck">Consumer key (optional)</Label>
                <Input
                  id="wp-ck"
                  type="password"
                  value={wpConsumerKey}
                  onChange={(e) => setWpConsumerKey(e.target.value)}
                  placeholder={
                    wpSetupQuery.data?.hasKeys
                      ? "Leave blank to keep existing / .env key"
                      : "ck_… from WooCommerce REST API"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wp-cs">Consumer secret (optional)</Label>
                <Input
                  id="wp-cs"
                  type="password"
                  value={wpConsumerSecret}
                  onChange={(e) => setWpConsumerSecret(e.target.value)}
                  placeholder={
                    wpSetupQuery.data?.hasKeys
                      ? "Leave blank to keep existing / .env secret"
                      : "cs_… from WooCommerce REST API"
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Keys are stored in the channel config (service role), not git. Override with{" "}
                <code className="text-[10px]">WOO_SITE_URL</code> /{" "}
                <code className="text-[10px]">WOO_CONSUMER_KEY</code> /{" "}
                <code className="text-[10px]">WOO_CONSUMER_SECRET</code> on Render.
                {wpSetupQuery.data?.fromEnv?.key || wpSetupQuery.data?.fromEnv?.siteUrl
                  ? " Env credentials detected."
                  : null}
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
                    editing?.type === "indiamart" ||
                    editing?.type === "tradeindia" ||
                    editing?.type === "brainmine" ||
                    editing?.type === "wordpress"
                  ? "Save & connect"
                  : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={gmailCredOpen} onOpenChange={setGmailCredOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gmail OAuth credentials</DialogTitle>
            <DialogDescription>
              Same idea as n8n Gmail credentials: paste Google OAuth Client ID and Client Secret.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="gmail-cid">Client ID</Label>
              <Input
                id="gmail-cid"
                value={gmailClientId}
                onChange={(e) => setGmailClientId(e.target.value)}
                placeholder="xxxx.apps.googleusercontent.com"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gmail-csec">Client Secret</Label>
              <Input
                id="gmail-csec"
                type="password"
                value={gmailClientSecret}
                onChange={(e) => setGmailClientSecret(e.target.value)}
                placeholder="GOCSPX-…"
                autoComplete="off"
              />
            </div>
            <p className="text-[11px] text-muted-foreground break-all">
              Redirect URI: {gmailSetupQuery.data?.redirectUri}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGmailCredOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                saveGmailCredMutation.isPending ||
                gmailClientId.trim().length < 8 ||
                gmailClientSecret.trim().length < 8
              }
              onClick={() => saveGmailCredMutation.mutate()}
            >
              {saveGmailCredMutation.isPending ? "Saving…" : "Save credentials"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bmInspectOpen}
        onOpenChange={(open) => {
          setBmInspectOpen(open);
          if (!open) setBmInspectResult(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Brainmine field inspection</DialogTitle>
            <DialogDescription>
              Read-only discovery of CRM fields for Requirement / Query mapping. Sample lead:{" "}
              <code className="text-xs">{bmInspectResult?.leadId || "—"}</code>
              {bmInspectResult
                ? ` · ${bmInspectResult.sampleFieldCount} fields on document`
                : null}
            </DialogDescription>
          </DialogHeader>
          {!bmInspectResult ? (
            <p className="text-sm text-muted-foreground">No inspection result yet.</p>
          ) : (
            <div className="space-y-4 text-sm">
              {"diagnosis" in bmInspectResult && bmInspectResult.diagnosis ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
                  {bmInspectResult.diagnosis}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{bmInspectResult.hint}</p>

              {"resolvedRequirement" in bmInspectResult && bmInspectResult.resolvedRequirement ? (
                <div>
                  <p className="mb-1.5 font-medium text-foreground">Resolved Requirement preview</p>
                  <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs">
                    {bmInspectResult.resolvedRequirement}
                  </p>
                </div>
              ) : null}

              {"itemsExpanded" in bmInspectResult &&
              Array.isArray(bmInspectResult.itemsExpanded) &&
              bmInspectResult.itemsExpanded.length > 0 ? (
                <div>
                  <p className="mb-1.5 font-medium text-foreground">
                    Opportunity Items (expanded)
                  </p>
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border p-2 font-mono text-[11px]">
                    {bmInspectResult.itemsExpanded.map((row, i) => (
                      <li key={i}>
                        {Object.entries(row)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(" · ")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {"linkedLead" in bmInspectResult && bmInspectResult.linkedLead ? (
                <div>
                  <p className="mb-1.5 font-medium text-foreground">
                    Linked Lead {bmInspectResult.linkedLead.id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {bmInspectResult.linkedLead.requirementPreview
                      ? `Requirement: ${bmInspectResult.linkedLead.requirementPreview}`
                      : bmInspectResult.linkedLead.hasQueryAbout
                        ? "Has query_about field but empty"
                        : "No query_about / requirement text on linked Lead"}
                  </p>
                </div>
              ) : null}

              <div>
                <p className="mb-1.5 font-medium text-foreground">
                  Likely Requirement / Query (has value on sample)
                </p>
                {bmInspectResult.candidatesFromSample.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No keyword matches with data on this sample. Check Items / linked Lead above, or
                    ask Brainmine to expose a Query About field on the API.
                  </p>
                ) : (
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
                    {bmInspectResult.candidatesFromSample.map((f) => (
                      <li key={f.key} className="text-xs">
                        <code className="font-semibold text-foreground">{f.key}</code>
                        <span className="text-muted-foreground"> — {f.valuePreview || "(empty)"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-1.5 font-medium text-foreground">
                  Meta candidates (DocType / Custom Field names)
                </p>
                {bmInspectResult.candidatesFromMeta.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Could not load DocField/Custom Field meta, or none matched keywords.
                  </p>
                ) : (
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
                    {bmInspectResult.candidatesFromMeta.map((f) => (
                      <li key={`${f.source}-${f.key}`} className="text-xs">
                        <code className="font-semibold text-foreground">{f.key}</code>
                        {f.label ? (
                          <span className="text-muted-foreground"> ({f.label})</span>
                        ) : null}
                        <span className="text-muted-foreground">
                          {" "}
                          · {f.source}
                          {f.empty ? " · empty on sample" : ` — ${f.valuePreview}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-1.5 font-medium text-foreground">All fields on sample lead</p>
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2 font-mono text-[11px]">
                  {bmInspectResult.allFields.map((f) => (
                    <li key={f.key} className={f.empty ? "text-muted-foreground/70" : ""}>
                      <span className="text-foreground">{f.key}</span>
                      {f.empty ? " = (empty)" : ` = ${f.valuePreview}`}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBmInspectOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={wpInspectOpen}
        onOpenChange={(open) => {
          setWpInspectOpen(open);
          if (!open) setWpInspectResult(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Inspect WordPress catalog</DialogTitle>
            <DialogDescription>
              {wpInspectResult?.siteUrl || WORDPRESS_DEFAULT_SITE}
              {wpInspectResult?.estimatedTotal != null
                ? ` · ≈${wpInspectResult.estimatedTotal} published`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {!wpInspectResult ? (
            <p className="text-sm text-muted-foreground">No inspection result yet.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-foreground">
                {wpInspectResult.hint}
              </p>
              <p className="text-xs text-muted-foreground">{wpInspectResult.pdfHint}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <Pill tone={wpInspectResult.storeApiOk ? "success" : "danger"}>
                  Store API {wpInspectResult.storeApiOk ? "ok" : "fail"}
                </Pill>
                <Pill tone={wpInspectResult.restV3Ok ? "success" : "warning"}>
                  REST v3 {wpInspectResult.restV3Ok ? "ok" : `HTTP ${wpInspectResult.restV3Status ?? "—"}`}
                </Pill>
                <Pill tone={wpInspectResult.hasKeys ? "success" : "neutral"}>
                  {wpInspectResult.hasKeys ? "Keys saved" : "No REST keys"}
                </Pill>
              </div>
              <p className="text-xs text-muted-foreground">
                Sample: {wpInspectResult.withImage} photos · {wpInspectResult.withPrice} prices ·{" "}
                {wpInspectResult.withPdf} PDFs · {wpInspectResult.skuEmpty} missing SKU
              </p>
              {wpInspectResult.sample.length === 0 ? (
                <p className="text-xs text-muted-foreground">No sample products returned.</p>
              ) : (
                <ul className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-border p-2 text-xs">
                  {wpInspectResult.sample.map((p) => (
                    <li key={p.id}>
                      <span className="font-medium text-foreground">{p.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {p.mappedSku}
                        {p.priceLabel ? ` · ${p.priceLabel}` : ""}
                        {p.imageUrl ? " · photo" : ""}
                        {p.catalogueUrl ? " · PDF" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setWpInspectOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bmWritebackInspectOpen} onOpenChange={setBmWritebackInspectOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Inspect write-back fields</DialogTitle>
            <DialogDescription>
              Discover the Follow Up Activity child table fieldname on Brainmine (separate from lead
              sync Requirement mapping).
            </DialogDescription>
          </DialogHeader>
          {!bmWritebackInspectResult ? (
            <p className="text-sm text-muted-foreground">No inspection result yet.</p>
          ) : (
            <div className="space-y-4 text-sm">
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
                {bmWritebackInspectResult.diagnosis}
              </p>
              <p className="text-xs text-muted-foreground">
                Sample: <code>{bmWritebackInspectResult.sampleId}</code> · DocType{" "}
                <code>{bmWritebackInspectResult.doctype}</code>
              </p>
              <p className="text-xs text-muted-foreground">{bmWritebackInspectResult.hint}</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Follow-up table fieldname</Label>
                  <Input
                    value={wbTable}
                    onChange={(e) => setWbTable(e.target.value)}
                    placeholder="e.g. custom_follow_up_activity_table"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Type field</Label>
                  <Input
                    value={wbTypeField}
                    onChange={(e) => setWbTypeField(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact field</Label>
                  <Input
                    value={wbContactField}
                    onChange={(e) => setWbContactField(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Next date field</Label>
                  <Input
                    value={wbNextDateField}
                    onChange={(e) => setWbNextDateField(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Description field</Label>
                  <Input
                    value={wbDescField}
                    onChange={(e) => setWbDescField(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <p className="mb-1.5 font-medium text-foreground">
                  Follow-related Table fields (DocType meta)
                </p>
                {bmWritebackInspectResult.followUpMetaTables.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {bmWritebackInspectResult.metaError
                      ? `Meta error: ${bmWritebackInspectResult.metaError}`
                      : "None matched “follow” in fieldname/label. Check all child tables below."}
                  </p>
                ) : (
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
                    {bmWritebackInspectResult.followUpMetaTables.map((f) => (
                      <li key={`${f.source}-${f.fieldname}`} className="flex flex-wrap items-center gap-2 text-xs">
                        <code className="font-semibold text-foreground">{f.fieldname}</code>
                        <span className="text-muted-foreground">
                          {f.label || "—"} · {f.source}
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7"
                          onClick={() => setWbTable(f.fieldname)}
                        >
                          Use table
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-1.5 font-medium text-foreground">
                  Child tables on sample document
                </p>
                {bmWritebackInspectResult.childTables.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No arrays returned (empty Follow Up tables are often omitted by the API).
                  </p>
                ) : (
                  <ul className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-2">
                    {bmWritebackInspectResult.childTables.map((t) => (
                      <li key={t.key} className="text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="font-semibold text-foreground">{t.key}</code>
                          <span className="text-muted-foreground">
                            {t.rowCount} row(s) · score {t.score}
                          </span>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7"
                            onClick={() => {
                              setWbTable(t.key);
                              if (t.columns.length) {
                                const inferred = t.columns;
                                const typeCol =
                                  inferred.find((c) => /type/i.test(c)) || wbTypeField;
                                const contactCol =
                                  inferred.find((c) => /contact/i.test(c)) || wbContactField;
                                const dateCol =
                                  inferred.find((c) => /date/i.test(c)) || wbNextDateField;
                                const descCol =
                                  inferred.find((c) => /desc/i.test(c)) || wbDescField;
                                setWbTypeField(typeCol);
                                setWbContactField(contactCol);
                                setWbNextDateField(dateCol);
                                setWbDescField(descCol);
                              }
                            }}
                          >
                            Use table
                          </Button>
                        </div>
                        {t.columns.length ? (
                          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                            columns: {t.columns.join(", ")}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-1.5 font-medium text-foreground">All keys on sample</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2 font-mono text-[11px]">
                  {bmWritebackInspectResult.allKeys.map((f) => (
                    <li key={f.key} className="text-muted-foreground">
                      <span className="text-foreground">{f.key}</span> · {f.kind} = {f.preview}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setBmWritebackInspectOpen(false)}>
              Close
            </Button>
            <Button
              disabled={!wbTable.trim() || saveWbMapMutation.isPending}
              onClick={() => saveWbMapMutation.mutate()}
            >
              {saveWbMapMutation.isPending ? "Saving…" : "Save mapping"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
