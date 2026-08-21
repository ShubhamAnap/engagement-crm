import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  Copy,
  CreditCard,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  ShieldOff,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, PageHeader, Panel, Pill } from "@/components/shared/ui-kit";
import { ChannelBrandMark } from "@/components/shared/ChannelBrandMark";
import { Progress } from "@/components/ui/progress";
import {
  formatInr,
  labelAuditAction,
  labelBillingStatus,
  labelPlanTier,
} from "@/lib/platform-labels";
import { cn } from "@/lib/utils";
import {
  addPlatformAdminByEmail,
  checkPlatformAccess,
  getPlatformOrganization,
  getPlatformOverview,
  listPlatformAdmins,
  listPlatformAuditEvents,
  listPlatformOrganizations,
  platformIssueBillingCredit,
  platformLogSupportAccess,
  platformReactivateOrganization,
  platformResetUsageGrace,
  platformSetContract,
  platformSetFeatureFlags,
  platformSetMemberActive,
  platformSetOrganizationPlan,
  platformSuspendOrganization,
  platformUpdateOrgNotes,
  removePlatformAdmin,
  type PlatformOrgRow,
} from "@/server/platform-console";
import { getPlatformRiskSignals, type RiskSeverity } from "@/server/platform-risk";
import {
  getPlatformSettings,
  setPlatformMaintenance,
  type MaintenanceSeverity,
} from "@/server/platform-settings";
import { startPlatformImpersonation } from "@/server/platform-impersonation";
import { downloadCsv } from "@/lib/csv";
import { FEATURE_CATALOG, FEATURE_KEYS, parseFeatureFlags, type FeatureKey } from "@/lib/features";
import { parseCustomLimits } from "@/lib/plans";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/platform/")({
  head: () => ({
    meta: [{ title: "Platform" }],
  }),
  component: PlatformConsolePage,
});

type StatusFilter = "all" | "live" | "suspended" | "past_due";
type PlanFilter = "all" | "free" | "starter" | "pro" | "enterprise";
type DetailTab =
  | "overview"
  | "team"
  | "channels"
  | "billing"
  | "features"
  | "audit"
  | "notes";

function PlatformConsolePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refreshProfile } = useAuth();

  const accessQuery = useQuery({
    queryKey: ["platform-access"],
    queryFn: () => checkPlatformAccess(),
    retry: false,
  });

  const overviewQuery = useQuery({
    queryKey: ["platform-overview"],
    queryFn: () => getPlatformOverview(),
    enabled: accessQuery.isSuccess,
  });

  const orgsQuery = useQuery({
    queryKey: ["platform-orgs"],
    queryFn: () => listPlatformOrganizations(),
    enabled: accessQuery.isSuccess,
  });

  const globalAuditQuery = useQuery({
    queryKey: ["platform-audit-global"],
    queryFn: () => listPlatformAuditEvents({ data: { limit: 40 } }),
    enabled: accessQuery.isSuccess,
  });

  const adminsQuery = useQuery({
    queryKey: ["platform-admins"],
    queryFn: () => listPlatformAdmins(),
    enabled: accessQuery.isSuccess,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [shellTab, setShellTab] = useState<"tenants" | "risk" | "admins" | "activity" | "ops">(
    "tenants",
  );

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendNotes, setSuspendNotes] = useState("");
  const [planOpen, setPlanOpen] = useState(false);
  const [planTier, setPlanTier] = useState("free");
  const [planNote, setPlanNote] = useState("");
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditNote, setCreditNote] = useState("");
  const [creditDowngrade, setCreditDowngrade] = useState(true);
  const [supportNotes, setSupportNotes] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [copiedId, setCopiedId] = useState(false);

  const [features, setFeatures] = useState<Record<FeatureKey, boolean>>(() =>
    parseFeatureFlags({}),
  );
  const [contractOpen, setContractOpen] = useState(false);
  const [trialEnds, setTrialEnds] = useState("");
  const [contractRef, setContractRef] = useState("");
  const [contractEnds, setContractEnds] = useState("");
  const [capAi, setCapAi] = useState("");
  const [capWa, setCapWa] = useState("");
  const [capSeats, setCapSeats] = useState("");

  const riskQuery = useQuery({
    queryKey: ["platform-risk"],
    queryFn: () => getPlatformRiskSignals(),
    enabled: accessQuery.isSuccess && shellTab === "risk",
  });

  const settingsQuery = useQuery({
    queryKey: ["platform-settings"],
    queryFn: () => getPlatformSettings(),
    enabled: accessQuery.isSuccess && shellTab === "ops",
  });

  const [maintEnabled, setMaintEnabled] = useState(false);
  const [maintMessage, setMaintMessage] = useState("");
  const [maintSeverity, setMaintSeverity] = useState<MaintenanceSeverity>("info");

  useEffect(() => {
    const s = settingsQuery.data;
    if (!s) return;
    setMaintEnabled(s.maintenanceEnabled);
    setMaintMessage(s.maintenanceMessage);
    setMaintSeverity(s.maintenanceSeverity);
  }, [
    settingsQuery.data?.maintenanceEnabled,
    settingsQuery.data?.maintenanceMessage,
    settingsQuery.data?.maintenanceSeverity,
  ]);

  const detailQuery = useQuery({
    queryKey: ["platform-org", selectedId],
    queryFn: () => getPlatformOrganization({ data: { orgId: selectedId! } }),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (accessQuery.isError) {
      toast.error("Platform access required");
      void navigate({ to: "/" });
    }
  }, [accessQuery.isError, navigate]);

  useEffect(() => {
    const tier = detailQuery.data?.organization?.plan_tier;
    if (tier) setPlanTier(String(tier));
    const notes = detailQuery.data?.organization?.platform_notes;
    setSupportNotes(typeof notes === "string" ? notes : "");
  }, [detailQuery.data?.organization?.plan_tier, detailQuery.data?.organization?.platform_notes]);

  const org = detailQuery.data?.organization as Record<string, unknown> | undefined;

  useEffect(() => {
    setFeatures(parseFeatureFlags(org?.feature_flags));
    setTrialEnds(toDateInput(org?.trial_ends_at));
    setContractRef(typeof org?.contract_reference === "string" ? org.contract_reference : "");
    setContractEnds(toDateInput(org?.contract_ends_at));
    const caps = parseCustomLimits(org?.custom_limits);
    setCapAi(capInput(caps.monthlyAiSpendCapInr));
    setCapWa(capInput(caps.monthlyWhatsAppCap));
    setCapSeats(capInput(caps.maxSeats));
  }, [
    org?.feature_flags,
    org?.trial_ends_at,
    org?.contract_reference,
    org?.contract_ends_at,
    org?.custom_limits,
  ]);

  const orgs = orgsQuery.data ?? [];

  const filteredOrgs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orgs.filter((org) => {
      if (statusFilter === "live" && (org.platform_suspended || !org.is_active)) return false;
      if (statusFilter === "suspended" && !(org.platform_suspended || !org.is_active)) return false;
      if (statusFilter === "past_due" && org.billing_status !== "past_due") return false;
      if (planFilter !== "all" && String(org.plan_tier || "free") !== planFilter) return false;
      if (!q) return true;
      return (
        org.name.toLowerCase().includes(q) ||
        (org.short_name || "").toLowerCase().includes(q) ||
        org.id.toLowerCase().includes(q)
      );
    });
  }, [orgs, search, statusFilter, planFilter]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["platform-orgs"] }),
      queryClient.invalidateQueries({ queryKey: ["platform-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["platform-audit-global"] }),
      queryClient.invalidateQueries({ queryKey: ["platform-admins"] }),
    ]);
    if (selectedId) {
      await queryClient.invalidateQueries({ queryKey: ["platform-org", selectedId] });
    }
  };

  const suspendMutation = useMutation({
    mutationFn: () =>
      platformSuspendOrganization({
        data: {
          orgId: selectedId!,
          reason: suspendReason.trim() || undefined,
          notes: suspendNotes.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      toast.success("Organization suspended");
      setSuspendOpen(false);
      setSuspendReason("");
      setSuspendNotes("");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not suspend"),
  });

  const reactivateMutation = useMutation({
    mutationFn: () => platformReactivateOrganization({ data: { orgId: selectedId! } }),
    onSuccess: async () => {
      toast.success("Organization reactivated");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reactivate"),
  });

  const planMutation = useMutation({
    mutationFn: () =>
      platformSetOrganizationPlan({
        data: {
          orgId: selectedId!,
          planTier: planTier as "free" | "starter" | "pro" | "enterprise",
          billingStatus: "active",
          note: planNote.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      toast.success(`Plan updated to ${labelPlanTier(planTier)}`);
      setPlanOpen(false);
      setPlanNote("");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update plan"),
  });

  const creditMutation = useMutation({
    mutationFn: () =>
      platformIssueBillingCredit({
        data: {
          orgId: selectedId!,
          note: creditNote.trim(),
          downgradeToFree: creditDowngrade,
        },
      }),
    onSuccess: async () => {
      toast.success("Billing credit recorded");
      setCreditOpen(false);
      setCreditNote("");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record credit"),
  });

  const notesMutation = useMutation({
    mutationFn: () =>
      platformUpdateOrgNotes({ data: { orgId: selectedId!, notes: supportNotes } }),
    onSuccess: async () => {
      toast.success("Support notes saved");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save notes"),
  });

  const memberMutation = useMutation({
    mutationFn: (input: { userId: string; isActive: boolean }) =>
      platformSetMemberActive({
        data: { orgId: selectedId!, userId: input.userId, isActive: input.isActive },
      }),
    onSuccess: async () => {
      toast.success("Member updated");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update member"),
  });

  const addAdminMutation = useMutation({
    mutationFn: () => addPlatformAdminByEmail({ data: { email: adminEmail.trim() } }),
    onSuccess: async () => {
      toast.success("Platform admin added");
      setAdminEmail("");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add admin"),
  });

  const removeAdminMutation = useMutation({
    mutationFn: (userId: string) => removePlatformAdmin({ data: { userId } }),
    onSuccess: async () => {
      toast.success("Platform admin removed");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove admin"),
  });

  const supportAccessMutation = useMutation({
    mutationFn: () => platformLogSupportAccess({ data: { orgId: selectedId! } }),
    onSuccess: async () => {
      toast.success("Support access logged");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not log access"),
  });

  const featuresMutation = useMutation({
    mutationFn: () => platformSetFeatureFlags({ data: { orgId: selectedId!, flags: features } }),
    onSuccess: async () => {
      toast.success("Modules updated");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update modules"),
  });

  const contractMutation = useMutation({
    mutationFn: () =>
      platformSetContract({
        data: {
          orgId: selectedId!,
          trialEndsAt: trialEnds ? `${trialEnds}T23:59:59.999Z` : null,
          contractReference: contractRef.trim() || null,
          contractEndsAt: contractEnds ? `${contractEnds}T23:59:59.999Z` : null,
          customLimits: {
            monthlyAiSpendCapInr: parseCapInput(capAi),
            monthlyWhatsAppCap: parseCapInput(capWa),
            maxSeats: parseCapInput(capSeats),
          },
        },
      }),
    onSuccess: async () => {
      toast.success("Trial and contract saved");
      setContractOpen(false);
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save contract"),
  });

  const graceMutation = useMutation({
    mutationFn: () => platformResetUsageGrace({ data: { orgId: selectedId! } }),
    onSuccess: async () => {
      toast.success("Grace window cleared");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not clear grace"),
  });

  const maintenanceMutation = useMutation({
    mutationFn: () =>
      setPlatformMaintenance({
        data: {
          enabled: maintEnabled,
          message: maintMessage,
          severity: maintSeverity,
        },
      }),
    onSuccess: async () => {
      toast.success(maintEnabled ? "Maintenance banner on" : "Maintenance banner off");
      await queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["platform-maintenance-banner"] });
      await queryClient.invalidateQueries({ queryKey: ["platform-audit-global"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save maintenance"),
  });

  const impersonateMutation = useMutation({
    mutationFn: () => startPlatformImpersonation({ data: { orgId: selectedId! } }),
    onSuccess: async (res) => {
      toast.success(`Support mode: ${res.orgName}`);
      await refreshProfile();
      await queryClient.invalidateQueries();
      void navigate({ to: "/" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not start support mode"),
  });

  if (accessQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Checking access…
      </div>
    );
  }

  if (accessQuery.isError) return null;

  const detail = detailQuery.data;
  const stats = overviewQuery.data;
  const orgSuspended =
    detail?.organization?.platform_suspended === true || detail?.organization?.is_active === false;

  const today = new Date().toISOString().slice(0, 10);

  const exportOrgs = () => {
    if (filteredOrgs.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    downloadCsv(`engage-workspaces-${today}.csv`, [
      ["Workspace", "Short name", "Org ID", "Plan", "Billing status", "State", "Members", "Created"],
      ...filteredOrgs.map((o) => [
        o.name,
        o.short_name || "",
        o.id,
        labelPlanTier(o.plan_tier),
        labelBillingStatus(o.billing_status),
        o.platform_suspended || !o.is_active ? "Suspended" : "Live",
        String(o.member_count),
        new Date(o.created_at).toLocaleDateString(),
      ]),
    ]);
    toast.success(`Exported ${filteredOrgs.length} workspaces`);
  };

  const exportRisk = () => {
    const rows = riskQuery.data?.rows ?? [];
    if (rows.length === 0) {
      toast.error("No risk signals to export");
      return;
    }
    downloadCsv(`engage-risk-${today}.csv`, [
      [
        "Workspace",
        "Org ID",
        "Plan",
        "Billing status",
        "Members",
        "AI spend (INR)",
        "AI cap",
        "WhatsApp sent",
        "WhatsApp cap",
        "Today spend",
        "Avg daily spend",
        "Signals",
      ],
      ...rows.map((r) => [
        r.name,
        r.orgId,
        labelPlanTier(r.planTier),
        labelBillingStatus(r.billingStatus),
        String(r.memberCount),
        String(r.aiSpendInr),
        r.aiCapInr == null ? "Unlimited" : String(r.aiCapInr),
        String(r.whatsappMessages),
        r.whatsappCap == null ? "Unlimited" : String(r.whatsappCap),
        String(r.todaySpendInr),
        String(r.avgDailySpendInr),
        r.signals.map((s) => `${s.label} (${s.detail})`).join("; "),
      ]),
    ]);
    toast.success(`Exported ${rows.length} workspaces`);
  };

  const copyOrgId = async () => {
    if (!selectedId) return;
    try {
      await navigator.clipboard.writeText(selectedId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_40%)]">
      <PageHeader
        title="Platform"
        description="Manage every workspace — plans, risk, team, and billing."
        meta={
          accessQuery.data?.email ? (
            <span className="text-xs text-muted-foreground">Signed in as {accessQuery.data.email}</span>
          ) : null
        }
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/">
                <ArrowLeft className="mr-1 size-3.5" /> Workspace
              </Link>
            </Button>
            <Button size="sm" variant="outline" onClick={exportOrgs}>
              <Download className="mr-1 size-3.5" /> Export
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={orgsQuery.isFetching || overviewQuery.isFetching}
              onClick={() => {
                void orgsQuery.refetch();
                void overviewQuery.refetch();
                void globalAuditQuery.refetch();
                void riskQuery.refetch();
              }}
            >
              <RefreshCw className="mr-1 size-3.5" /> Refresh
            </Button>
          </div>
        }
      />

      <div className="mx-auto max-w-7xl space-y-4 p-4 lg:p-6">
        {/* Phase 2: KPI strip */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard label="Workspaces" value={stats?.totalOrgs ?? "—"} />
          <KpiCard label="Live" value={stats?.liveOrgs ?? "—"} tone="success" />
          <KpiCard label="Suspended" value={stats?.suspendedOrgs ?? "—"} tone="danger" />
          <KpiCard label="Past due" value={stats?.pastDueOrgs ?? "—"} tone="warning" />
          <KpiCard label="Members" value={stats?.totalMembers ?? "—"} />
        </div>

        <Tabs value={shellTab} onValueChange={(v) => setShellTab(v as typeof shellTab)}>
          <TabsList>
            <TabsTrigger value="tenants">Workspaces</TabsTrigger>
            <TabsTrigger value="risk">Risk</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="ops">Ops</TabsTrigger>
            <TabsTrigger value="admins">Admins</TabsTrigger>
          </TabsList>

          <TabsContent value="tenants" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
              <Panel
                title={`Workspaces (${filteredOrgs.length})`}
                bodyClassName="p-0"
                action={
                  <div className="flex gap-1 text-[10px] text-muted-foreground">
                    {stats ? (
                      <>
                        <span>F {stats.byPlan.free || 0}</span>
                        <span>·</span>
                        <span>S {stats.byPlan.starter || 0}</span>
                        <span>·</span>
                        <span>P {stats.byPlan.pro || 0}</span>
                        <span>·</span>
                        <span>E {stats.byPlan.enterprise || 0}</span>
                      </>
                    ) : null}
                  </div>
                }
              >
                <div className="space-y-2 border-b border-border p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                    <Input
                      className="h-9 pl-8"
                      placeholder="Search name…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All status</SelectItem>
                        <SelectItem value="live">Live</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                        <SelectItem value="past_due">Past due</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={planFilter} onValueChange={(v) => setPlanFilter(v as PlanFilter)}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Plan" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All plans</SelectItem>
                        <SelectItem value="free">Free</SelectItem>
                        <SelectItem value="starter">Starter</SelectItem>
                        <SelectItem value="pro">Pro</SelectItem>
                        <SelectItem value="enterprise">Enterprise</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {orgsQuery.isLoading ? (
                  <p className="p-4 text-sm text-muted-foreground">Loading…</p>
                ) : filteredOrgs.length === 0 ? (
                  <EmptyState title="No matches" description="Try a different search or filter." />
                ) : (
                  <ul className="max-h-[62vh] divide-y divide-border overflow-y-auto">
                    {filteredOrgs.map((org) => (
                      <OrgListItem
                        key={org.id}
                        org={org}
                        selected={selectedId === org.id}
                        onSelect={() => {
                          setSelectedId(org.id);
                          setDetailTab("overview");
                        }}
                      />
                    ))}
                  </ul>
                )}
              </Panel>

              <div className="space-y-4">
                {!selectedId ? (
                  <Panel title="Select a workspace">
                    <p className="text-sm text-muted-foreground">
                      Choose a workspace from the list to inspect usage, team, channels, and billing.
                    </p>
                  </Panel>
                ) : detailQuery.isLoading ? (
                  <Panel title="Loading">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </Panel>
                ) : detail ? (
                  <>
                    <Panel
                      title={detail.organization.name}
                      action={
                        <div className="flex flex-wrap gap-2">
                          <Pill tone="info">{labelPlanTier(detail.organization.plan_tier)}</Pill>
                          {orgSuspended ? (
                            <Pill tone="danger" dot>
                              Suspended
                            </Pill>
                          ) : (
                            <Pill tone="success" dot>
                              Live
                            </Pill>
                          )}
                          {detail.organization.billing_status &&
                          detail.organization.billing_status !== "active" ? (
                            <Pill tone="warning">
                              {labelBillingStatus(detail.organization.billing_status)}
                            </Pill>
                          ) : null}
                        </div>
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>Created {new Date(detail.organization.created_at).toLocaleDateString()}</span>
                        <span>·</span>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:bg-secondary/50"
                          onClick={() => void copyOrgId()}
                        >
                          {copiedId ? <Check className="size-3" /> : <Copy className="size-3" />}
                          Copy ID
                        </button>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {orgSuspended ? (
                          <Button
                            size="sm"
                            disabled={reactivateMutation.isPending}
                            onClick={() => reactivateMutation.mutate()}
                          >
                            <Shield className="mr-1 size-3.5" /> Reactivate
                          </Button>
                        ) : (
                          <Button size="sm" variant="destructive" onClick={() => setSuspendOpen(true)}>
                            <ShieldOff className="mr-1 size-3.5" /> Suspend
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setPlanOpen(true)}>
                          Change plan
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setCreditOpen(true)}>
                          <CreditCard className="mr-1 size-3.5" /> Billing credit
                        </Button>
                        <Button
                          size="sm"
                          disabled={impersonateMutation.isPending}
                          onClick={() => {
                            if (
                              !confirm(
                                `Enter support mode for ${detail.organization.name}? You will see their workspace as Admin for up to 2 hours.`,
                              )
                            ) {
                              return;
                            }
                            impersonateMutation.mutate();
                          }}
                        >
                          Open as support
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={supportAccessMutation.isPending}
                          onClick={() => supportAccessMutation.mutate()}
                        >
                          Log access only
                        </Button>
                      </div>
                    </Panel>

                    <Tabs value={detailTab} onValueChange={(v) => setDetailTab(v as DetailTab)}>
                      <TabsList className="flex h-auto flex-wrap gap-1">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="team">Team</TabsTrigger>
                        <TabsTrigger value="channels">Channels</TabsTrigger>
                        <TabsTrigger value="billing">Billing</TabsTrigger>
                        <TabsTrigger value="features">Modules</TabsTrigger>
                        <TabsTrigger value="audit">Audit</TabsTrigger>
                        <TabsTrigger value="notes">Notes</TabsTrigger>
                      </TabsList>

                      <TabsContent value="overview" className="mt-3 space-y-3">
                        <Panel title="Usage this month">
                          <div className="grid gap-4 sm:grid-cols-3">
                            <UsageMeter
                              label="AI spend"
                              used={detail.usage.aiSpendInr}
                              cap={detail.usage.limits.monthlyAiSpendCapInr}
                              format={formatInr}
                            />
                            <UsageMeter
                              label="WhatsApp"
                              used={detail.usage.whatsappMessages}
                              cap={detail.usage.limits.monthlyWhatsAppCap}
                            />
                            <UsageMeter
                              label="Seats"
                              used={detail.usage.seatsUsed}
                              cap={detail.usage.limits.maxSeats}
                              hint={
                                detail.usage.pendingInvites
                                  ? `+${detail.usage.pendingInvites} pending invites`
                                  : undefined
                              }
                            />
                          </div>
                          <p className="mt-3 text-xs text-muted-foreground">
                            Own OpenAI key: {detail.usage.hasOwnOpenAiKey ? "Yes" : "No"}
                            {detail.usage.hasCustomLimits ? " · caps set by contract" : ""}
                          </p>
                          {detail.usage.trialActive ||
                          detail.usage.usageGraceUntil ||
                          detail.usage.pastDueGraceUntil ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {detail.usage.trialActive && detail.usage.trialEndsAt ? (
                                <Pill tone="info">
                                  Trial until{" "}
                                  {new Date(detail.usage.trialEndsAt).toLocaleDateString()}
                                </Pill>
                              ) : null}
                              {detail.usage.usageGraceUntil ? (
                                <Pill tone="warning">
                                  Over cap, served until{" "}
                                  {new Date(detail.usage.usageGraceUntil).toLocaleDateString()}
                                </Pill>
                              ) : null}
                              {detail.usage.pastDueGraceUntil ? (
                                <Pill tone="danger">
                                  Past due, cut off{" "}
                                  {new Date(detail.usage.pastDueGraceUntil).toLocaleDateString()}
                                </Pill>
                              ) : null}
                            </div>
                          ) : null}
                        </Panel>
                      </TabsContent>

                      <TabsContent value="team" className="mt-3">
                        <Panel title={`Team (${detail.team.length})`}>
                          {detail.team.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No members.</p>
                          ) : (
                            <ul className="divide-y divide-border">
                              {detail.team.map((m) => (
                                <li
                                  key={m.id}
                                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">
                                      {m.full_name || m.email}
                                    </p>
                                    <p className="truncate text-xs text-muted-foreground">
                                      {m.email} · {m.role}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Pill tone={m.is_active === false ? "danger" : "success"}>
                                      {m.is_active === false ? "Disabled" : "Active"}
                                    </Pill>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={memberMutation.isPending}
                                      onClick={() =>
                                        memberMutation.mutate({
                                          userId: m.id,
                                          isActive: m.is_active === false,
                                        })
                                      }
                                    >
                                      {m.is_active === false ? "Enable" : "Disable"}
                                    </Button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </Panel>
                      </TabsContent>

                      <TabsContent value="channels" className="mt-3">
                        <Panel title={`Channels (${detail.channels.length})`}>
                          {detail.channels.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No channels configured.</p>
                          ) : (
                            <ul className="grid gap-2 sm:grid-cols-2">
                              {detail.channels.map((ch) => (
                                <li
                                  key={ch.id}
                                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                                >
                                  <ChannelBrandMark channel={String(ch.type)} size="md" />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{ch.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {ch.status}
                                      {ch.is_enabled === false ? " · Off" : ""}
                                    </p>
                                  </div>
                                  <Pill tone={ch.is_enabled === false ? "neutral" : "success"}>
                                    {ch.health != null ? `${ch.health}%` : "—"}
                                  </Pill>
                                </li>
                              ))}
                            </ul>
                          )}
                        </Panel>
                      </TabsContent>

                      <TabsContent value="billing" className="mt-3 space-y-3">
                        <Panel title="Billing">
                          <dl className="grid gap-2 text-sm sm:grid-cols-2">
                            <div>
                              <dt className="text-muted-foreground">Plan</dt>
                              <dd>{labelPlanTier(detail.organization.plan_tier)}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Status</dt>
                              <dd>{labelBillingStatus(detail.organization.billing_status)}</dd>
                            </div>
                          </dl>
                        </Panel>
                        <Panel title="Payment history">
                          {detail.invoices.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No payments recorded yet.
                            </p>
                          ) : (
                            <ul className="space-y-2 text-sm">
                              {detail.invoices.map((inv) => (
                                <li
                                  key={inv.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-2.5 py-2"
                                >
                                  <div className="min-w-0">
                                    <p className="font-medium">
                                      {inv.amount == null
                                        ? labelAuditAction(inv.eventType)
                                        : formatInr(inv.amount)}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {new Date(inv.createdAt).toLocaleString()}
                                      {inv.invoiceId ? ` · ${inv.invoiceId}` : ""}
                                    </p>
                                  </div>
                                  <Pill tone={invoiceTone(inv.status, inv.eventType)}>
                                    {inv.status || inv.eventType}
                                  </Pill>
                                </li>
                              ))}
                            </ul>
                          )}
                        </Panel>
                        <Panel title="Recent billing events">
                          {detail.billingEvents.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No billing events yet.</p>
                          ) : (
                            <ul className="space-y-2 text-sm">
                              {detail.billingEvents.map((e) => (
                                <li
                                  key={e.id}
                                  className="flex justify-between gap-2 rounded border border-border px-2 py-1.5"
                                >
                                  <span className="font-medium">{e.event_type}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(e.created_at).toLocaleString()}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </Panel>
                      </TabsContent>

                      <TabsContent value="features" className="mt-3 space-y-3">
                        <Panel
                          title="Modules"
                          description="Turn a module off to block it server-side for this workspace only."
                        >
                          <ul className="divide-y divide-border">
                            {FEATURE_KEYS.map((key) => (
                              <li
                                key={key}
                                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">{FEATURE_CATALOG[key].label}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {FEATURE_CATALOG[key].description}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Pill tone={features[key] ? "success" : "danger"}>
                                    {features[key] ? "On" : "Off"}
                                  </Pill>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setFeatures((prev) => ({ ...prev, [key]: !prev[key] }))
                                    }
                                  >
                                    {features[key] ? "Turn off" : "Turn on"}
                                  </Button>
                                </div>
                              </li>
                            ))}
                          </ul>
                          <Button
                            className="mt-3"
                            size="sm"
                            disabled={featuresMutation.isPending}
                            onClick={() => featuresMutation.mutate()}
                          >
                            Save modules
                          </Button>
                        </Panel>

                        <Panel
                          title="Trial and contract"
                          description="Trials hold the paid plan without a subscription. Contract caps override the plan's limits."
                          action={
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setContractOpen(true)}
                            >
                              <SlidersHorizontal className="mr-1 size-3.5" /> Edit
                            </Button>
                          }
                        >
                          <dl className="grid gap-3 text-sm sm:grid-cols-2">
                            <div>
                              <dt className="text-muted-foreground">Trial ends</dt>
                              <dd>{formatDateCell(org?.trial_ends_at)}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Contract reference</dt>
                              <dd>
                                {typeof org?.contract_reference === "string" &&
                                org.contract_reference
                                  ? org.contract_reference
                                  : "—"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Contract ends</dt>
                              <dd>{formatDateCell(org?.contract_ends_at)}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Contract caps</dt>
                              <dd>{describeCustomLimits(org?.custom_limits)}</dd>
                            </div>
                          </dl>
                        </Panel>

                        <Panel
                          title="Grace window"
                          description="Workspaces over a cap keep working for a few days before being blocked. Clear it after an upgrade so the next breach starts fresh."
                        >
                          <p className="text-sm">
                            {detail.usage.usageGraceUntil
                              ? `Serving over the cap until ${new Date(detail.usage.usageGraceUntil).toLocaleString()}.`
                              : "No grace window is open."}
                          </p>
                          <Button
                            className="mt-3"
                            size="sm"
                            variant="outline"
                            disabled={graceMutation.isPending}
                            onClick={() => graceMutation.mutate()}
                          >
                            Clear grace and past-due clock
                          </Button>
                        </Panel>
                      </TabsContent>

                      <TabsContent value="audit" className="mt-3">
                        <Panel title="Recent audit">
                          {detail.auditLog.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No audit events for this workspace yet.
                            </p>
                          ) : (
                            <ul className="max-h-80 space-y-2 overflow-y-auto">
                              {detail.auditLog.map((e) => (
                                <li key={e.id} className="rounded border border-border px-3 py-2 text-sm">
                                  <p className="font-medium">{labelAuditAction(e.action)}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {e.actor_email || "System"} ·{" "}
                                    {new Date(e.created_at).toLocaleString()}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </Panel>
                      </TabsContent>

                      <TabsContent value="notes" className="mt-3">
                        <Panel title="Support notes">
                          <Textarea
                            rows={6}
                            value={supportNotes}
                            onChange={(e) => setSupportNotes(e.target.value)}
                            placeholder="Internal notes for support (not visible to the customer)…"
                          />
                          <Button
                            className="mt-3"
                            size="sm"
                            disabled={notesMutation.isPending}
                            onClick={() => notesMutation.mutate()}
                          >
                            Save notes
                          </Button>
                        </Panel>
                      </TabsContent>
                    </Tabs>
                  </>
                ) : null}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="risk" className="mt-4">
            <Panel
              title="Attention needed"
              description={
                riskQuery.data
                  ? `${riskQuery.data.rows.length} of ${riskQuery.data.scannedOrgs} workspaces have signals · checked ${new Date(riskQuery.data.generatedAt).toLocaleTimeString()}`
                  : "Spend spikes, cap breaches, lapsed payments, and expiring trials."
              }
              action={
                <Button size="sm" variant="outline" onClick={exportRisk}>
                  <Download className="mr-1 size-3.5" /> Export
                </Button>
              }
            >
              {riskQuery.isLoading ? (
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              ) : riskQuery.isError ? (
                <EmptyState
                  icon={AlertTriangle}
                  title="Could not load risk signals"
                  description="Refresh to try again."
                />
              ) : (riskQuery.data?.rows ?? []).length === 0 ? (
                <EmptyState
                  icon={Shield}
                  title="Nothing needs attention"
                  description="No workspace is over a cap, spiking spend, or behind on payment."
                />
              ) : (
                <ul className="space-y-2">
                  {(riskQuery.data?.rows ?? []).map((row) => (
                    <li key={row.orgId} className="rounded-lg border border-border px-3 py-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{row.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {labelPlanTier(row.planTier)} · {labelBillingStatus(row.billingStatus)} ·{" "}
                            {row.memberCount} member{row.memberCount === 1 ? "" : "s"} ·{" "}
                            {formatInr(row.aiSpendInr)} AI this month
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedId(row.orgId);
                            setShellTab("tenants");
                            setDetailTab("overview");
                          }}
                        >
                          Open
                        </Button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {row.signals.map((s) => (
                          <Pill key={s.code} tone={severityTone(s.severity)}>
                            {s.label} — {s.detail}
                          </Pill>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            <Panel title="Platform activity">
              {globalAuditQuery.isLoading ? (
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              ) : (globalAuditQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No platform activity yet.</p>
              ) : (
                <ul className="max-h-[70vh] space-y-2 overflow-y-auto">
                  {(globalAuditQuery.data ?? []).map((e) => (
                    <li key={e.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{labelAuditAction(e.action)}</p>
                        <span className="text-xs text-muted-foreground">
                          {new Date(e.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {e.org_name || "Platform"} · {e.actor_email || "System"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </TabsContent>

          <TabsContent value="ops" className="mt-4 space-y-4">
            <Panel
              title="Maintenance banner"
              description="Shown at the top of every page, including sign-in. Use for planned downtime or incidents."
            >
              {settingsQuery.isLoading ? (
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              ) : settingsQuery.data?.missingMigration ? (
                <EmptyState
                  icon={AlertTriangle}
                  title="Migration required"
                  description="Run supabase/migrations/046_platform_settings.sql in the Supabase SQL Editor, then refresh."
                />
              ) : (
                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={maintEnabled}
                      onChange={(e) => setMaintEnabled(e.target.checked)}
                    />
                    Show maintenance banner to all workspaces
                  </label>
                  <div>
                    <Label htmlFor="maint-severity">Severity</Label>
                    <Select
                      value={maintSeverity}
                      onValueChange={(v) => setMaintSeverity(v as MaintenanceSeverity)}
                    >
                      <SelectTrigger id="maint-severity" className="mt-1 max-w-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="maint-message">Message</Label>
                    <Textarea
                      id="maint-message"
                      rows={3}
                      className="mt-1"
                      value={maintMessage}
                      onChange={(e) => setMaintMessage(e.target.value)}
                      placeholder="We are upgrading WhatsApp delivery tonight from 11pm–1am IST…"
                      maxLength={500}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {maintMessage.length}/500
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={maintenanceMutation.isPending}
                    onClick={() => maintenanceMutation.mutate()}
                  >
                    Save banner
                  </Button>
                  {settingsQuery.data?.updatedAt ? (
                    <p className="text-xs text-muted-foreground">
                      Last updated {new Date(settingsQuery.data.updatedAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
              )}
            </Panel>
            <Panel title="Launch checks (operator)">
              <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                <li>
                  Apply migrations through <code className="text-xs">046_platform_settings.sql</code>{" "}
                  in Supabase
                </li>
                <li>
                  Run <code className="text-xs">npm run check:db</code> locally against production
                  keys
                </li>
                <li>
                  Full checklist: <code className="text-xs">docs/launch-runbook.md</code>
                </li>
              </ul>
            </Panel>
          </TabsContent>

          <TabsContent value="admins" className="mt-4">
            <Panel title="Platform admins">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="Add by email…"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
                <Button
                  disabled={adminEmail.trim().length < 3 || addAdminMutation.isPending}
                  onClick={() => addAdminMutation.mutate()}
                >
                  <Users className="mr-1 size-3.5" /> Add admin
                </Button>
              </div>
              {(adminsQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rows in platform admins yet. Env emails still grant access.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {(adminsQuery.data ?? []).map((a) => (
                    <li key={a.userId} className="flex items-center justify-between gap-2 py-2.5">
                      <div>
                        <p className="text-sm font-medium">{a.fullName || a.email}</p>
                        <p className="text-xs text-muted-foreground">{a.email}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          removeAdminMutation.isPending || a.userId === accessQuery.data?.userId
                        }
                        onClick={() => {
                          if (!confirm(`Remove platform admin ${a.email}?`)) return;
                          removeAdminMutation.mutate(a.userId);
                        }}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </TabsContent>
        </Tabs>
      </div>

      {/* Suspend dialog */}
      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend organization</DialogTitle>
            <DialogDescription>
              Members will be blocked from signing in until you reactivate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="suspend-reason">Reason</Label>
              <Input
                id="suspend-reason"
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="Abuse, non-payment, request…"
              />
            </div>
            <div>
              <Label htmlFor="suspend-notes">Internal notes</Label>
              <Textarea
                id="suspend-notes"
                value={suspendNotes}
                onChange={(e) => setSuspendNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={suspendMutation.isPending || suspendReason.trim().length < 2}
              onClick={() => suspendMutation.mutate()}
            >
              Suspend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Plan dialog */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change plan</DialogTitle>
            <DialogDescription>Override the subscription plan for this workspace.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={planTier} onValueChange={setPlanTier}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Note (optional)"
              value={planNote}
              onChange={(e) => setPlanNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanOpen(false)}>
              Cancel
            </Button>
            <Button disabled={planMutation.isPending} onClick={() => planMutation.mutate()}>
              Apply plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credit dialog */}
      <Dialog open={creditOpen} onOpenChange={setCreditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record billing credit</DialogTitle>
            <DialogDescription>
              Marks billing as cancelled. Optionally move the workspace to Free.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="credit-note">Note</Label>
              <Input
                id="credit-note"
                value={creditNote}
                onChange={(e) => setCreditNote(e.target.value)}
                placeholder="Refund processed / goodwill credit…"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={creditDowngrade}
                onChange={(e) => setCreditDowngrade(e.target.checked)}
              />
              Also move to Free plan
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={creditNote.trim().length < 3 || creditMutation.isPending}
              onClick={() => creditMutation.mutate()}
            >
              Record credit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Trial and contract dialog */}
      <Dialog open={contractOpen} onOpenChange={setContractOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trial and contract</DialogTitle>
            <DialogDescription>
              Leave a cap blank to use the plan default. Enter 0 for unlimited.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="trial-ends">Trial ends</Label>
                <Input
                  id="trial-ends"
                  type="date"
                  value={trialEnds}
                  onChange={(e) => setTrialEnds(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="contract-ends">Contract ends</Label>
                <Input
                  id="contract-ends"
                  type="date"
                  value={contractEnds}
                  onChange={(e) => setContractEnds(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="contract-ref">Contract or PO reference</Label>
              <Input
                id="contract-ref"
                value={contractRef}
                onChange={(e) => setContractRef(e.target.value)}
                placeholder="ENT-2026-014"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="cap-ai">AI cap (₹/mo)</Label>
                <Input
                  id="cap-ai"
                  inputMode="numeric"
                  value={capAi}
                  onChange={(e) => setCapAi(e.target.value)}
                  placeholder="Plan default"
                />
              </div>
              <div>
                <Label htmlFor="cap-wa">WhatsApp cap</Label>
                <Input
                  id="cap-wa"
                  inputMode="numeric"
                  value={capWa}
                  onChange={(e) => setCapWa(e.target.value)}
                  placeholder="Plan default"
                />
              </div>
              <div>
                <Label htmlFor="cap-seats">Seats</Label>
                <Input
                  id="cap-seats"
                  inputMode="numeric"
                  value={capSeats}
                  onChange={(e) => setCapSeats(e.target.value)}
                  placeholder="Plan default"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContractOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={contractMutation.isPending}
              onClick={() => contractMutation.mutate()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** `<Input type="date">` needs YYYY-MM-DD; the column holds a timestamptz. */
function toDateInput(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function formatDateCell(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/** An unlimited cap is stored as null, which the text box shows as 0. */
function capInput(value: number | null | undefined): string {
  if (value === undefined) return "";
  return value === null ? "0" : String(value);
}

function parseCapInput(raw: string): number | null | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n === 0 ? null : n;
}

function describeCustomLimits(raw: unknown): string {
  const caps = parseCustomLimits(raw);
  const parts: string[] = [];
  if ("monthlyAiSpendCapInr" in caps) {
    parts.push(
      `AI ${caps.monthlyAiSpendCapInr == null ? "unlimited" : formatInr(caps.monthlyAiSpendCapInr)}`,
    );
  }
  if ("monthlyWhatsAppCap" in caps) {
    parts.push(
      `WhatsApp ${caps.monthlyWhatsAppCap == null ? "unlimited" : caps.monthlyWhatsAppCap.toLocaleString("en-IN")}`,
    );
  }
  if ("maxSeats" in caps) {
    parts.push(`Seats ${caps.maxSeats == null ? "unlimited" : caps.maxSeats}`);
  }
  return parts.length ? parts.join(" · ") : "Plan defaults";
}

function severityTone(severity: RiskSeverity): "danger" | "warning" | "neutral" {
  if (severity === "high") return "danger";
  if (severity === "medium") return "warning";
  return "neutral";
}

function invoiceTone(
  status: string | null,
  eventType: string,
): "success" | "danger" | "neutral" {
  const value = `${status || ""} ${eventType}`.toLowerCase();
  if (value.includes("fail")) return "danger";
  if (value.includes("captured") || value.includes("paid") || value.includes("charged")) {
    return "success";
  }
  return "neutral";
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "success" | "danger" | "warning";
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--et-card-shadow)]">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight",
          tone === "success" && "text-emerald-700",
          tone === "danger" && "text-red-700",
          tone === "warning" && "text-amber-700",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function UsageMeter({
  label,
  used,
  cap,
  format,
  hint,
}: {
  label: string;
  used: number;
  cap: number | null;
  format?: (n: number) => string;
  hint?: string;
}) {
  const fmt = format || ((n: number) => n.toLocaleString("en-IN"));
  const pct = cap == null || cap <= 0 ? 0 : Math.min(100, Math.round((used / cap) * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span>
          {fmt(used)}
          {cap == null ? " / ∞" : ` / ${fmt(cap)}`}
        </span>
      </div>
      <Progress value={cap == null ? 0 : pct} className="h-2" />
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function OrgListItem({
  org,
  selected,
  onSelect,
}: {
  org: PlatformOrgRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const off = !org.is_active || org.platform_suspended;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-secondary/40",
          selected && "bg-primary/5",
        )}
      >
        <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{org.name}</p>
          <p className="text-xs text-muted-foreground">
            {labelPlanTier(org.plan_tier)} · {org.member_count}{" "}
            {org.member_count === 1 ? "member" : "members"}
            {org.billing_status === "past_due" ? " · Past due" : ""}
          </p>
        </div>
        <Pill tone={off ? "danger" : "success"}>{off ? "Off" : "Live"}</Pill>
      </button>
    </li>
  );
}
