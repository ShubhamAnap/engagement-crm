import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  Loader2,
  RefreshCw,
  Shield,
  ShieldOff,
  CreditCard,
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
import { EmptyState, PageHeader, Panel, Pill } from "@/components/shared/ui-kit";
import {
  checkPlatformAccess,
  getPlatformOrganization,
  listPlatformOrganizations,
  platformIssueBillingCredit,
  platformReactivateOrganization,
  platformSetOrganizationPlan,
  platformSuspendOrganization,
  type PlatformOrgRow,
} from "@/server/platform-console";

export const Route = createFileRoute("/platform/")({
  head: () => ({
    meta: [{ title: "Platform console" }],
  }),
  component: PlatformConsolePage,
});

function PlatformConsolePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accessQuery = useQuery({
    queryKey: ["platform-access"],
    queryFn: () => checkPlatformAccess(),
    retry: false,
  });

  const orgsQuery = useQuery({
    queryKey: ["platform-orgs"],
    queryFn: () => listPlatformOrganizations(),
    enabled: accessQuery.isSuccess,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [platformNotes, setPlatformNotes] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [planTier, setPlanTier] = useState("free");

  const detailQuery = useQuery({
    queryKey: ["platform-org", selectedId],
    queryFn: () => getPlatformOrganization({ data: { orgId: selectedId! } }),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (accessQuery.isError) {
      toast.error("Platform admin access required");
      void navigate({ to: "/" });
    }
  }, [accessQuery.isError, navigate]);

  useEffect(() => {
    const tier = detailQuery.data?.organization?.plan_tier;
    if (tier) setPlanTier(String(tier));
  }, [detailQuery.data?.organization?.plan_tier]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["platform-orgs"] });
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
          notes: platformNotes.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      toast.success("Organization suspended");
      setSuspendReason("");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Suspend failed"),
  });

  const reactivateMutation = useMutation({
    mutationFn: () => platformReactivateOrganization({ data: { orgId: selectedId! } }),
    onSuccess: async () => {
      toast.success("Organization reactivated");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Reactivate failed"),
  });

  const planMutation = useMutation({
    mutationFn: () =>
      platformSetOrganizationPlan({
        data: {
          orgId: selectedId!,
          planTier: planTier as "free" | "starter" | "pro" | "enterprise",
          billingStatus: "active",
        },
      }),
    onSuccess: async () => {
      toast.success("Plan updated");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Plan update failed"),
  });

  const creditMutation = useMutation({
    mutationFn: () =>
      platformIssueBillingCredit({
        data: { orgId: selectedId!, note: creditNote.trim(), downgradeToFree: true },
      }),
    onSuccess: async () => {
      toast.success("Billing credit recorded — process Razorpay refund offline if needed");
      setCreditNote("");
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Credit failed"),
  });

  if (accessQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Verifying platform access…
      </div>
    );
  }

  if (accessQuery.isError) return null;

  const orgs = orgsQuery.data ?? [];
  const detail = detailQuery.data;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title="Platform console"
        description="Cross-tenant administration — suspend, inspect, and adjust billing."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/">
                <ArrowLeft className="mr-1 size-3.5" /> Workspace
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={orgsQuery.isFetching}
              onClick={() => void orgsQuery.refetch()}
            >
              <RefreshCw className="mr-1 size-3.5" /> Refresh
            </Button>
          </div>
        }
      />

      <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:p-6">
        <Panel title={`Organizations (${orgs.length})`} bodyClassName="p-0">
          {orgsQuery.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : orgs.length === 0 ? (
            <EmptyState title="No organizations" description="New signups will appear here." />
          ) : (
            <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
              {orgs.map((org) => (
                <OrgListItem
                  key={org.id}
                  org={org}
                  selected={selectedId === org.id}
                  onSelect={() => setSelectedId(org.id)}
                />
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-4">
          {!selectedId ? (
            <Panel title="Inspect organization">
              <p className="text-sm text-muted-foreground">Select an organization from the list.</p>
            </Panel>
          ) : detailQuery.isLoading ? (
            <Panel title="Loading…">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </Panel>
          ) : detail ? (
            <>
              <Panel title={detail.organization.name}>
                <div className="flex flex-wrap gap-2">
                  <Pill tone="info">{detail.organization.plan || detail.organization.plan_tier}</Pill>
                  <Pill tone={detail.organization.is_active !== false ? "success" : "danger"} dot>
                    {detail.organization.is_active !== false ? "Active" : "Disabled"}
                  </Pill>
                  {detail.organization.platform_suspended ? (
                    <Pill tone="danger">Platform suspended</Pill>
                  ) : null}
                  <Pill tone="neutral">{detail.organization.billing_status || "active"}</Pill>
                </div>
                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Org ID</dt>
                    <dd className="font-mono text-xs">{detail.organization.id}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd>{new Date(detail.organization.created_at).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">AI spend (mo)</dt>
                    <dd>₹{Math.round(detail.usage.aiSpendInr).toLocaleString("en-IN")}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">WhatsApp (mo)</dt>
                    <dd>{detail.usage.whatsappMessages.toLocaleString("en-IN")}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Seats</dt>
                    <dd>
                      {detail.usage.seatsUsed}
                      {detail.usage.pendingInvites ? ` + ${detail.usage.pendingInvites} pending` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">BYOK OpenAI</dt>
                    <dd>{detail.usage.hasOwnOpenAiKey ? "Yes" : "No"}</dd>
                  </div>
                </dl>
              </Panel>

              <Panel title="Actions">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <ShieldOff className="size-4" /> Suspend
                    </p>
                    <Input
                      placeholder="Reason (optional)"
                      value={suspendReason}
                      onChange={(e) => setSuspendReason(e.target.value)}
                    />
                    <Textarea
                      placeholder="Internal notes"
                      value={platformNotes}
                      onChange={(e) => setPlatformNotes(e.target.value)}
                      rows={2}
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={suspendMutation.isPending}
                      onClick={() => {
                        if (!confirm(`Suspend ${detail.organization.name}?`)) return;
                        suspendMutation.mutate();
                      }}
                    >
                      Suspend organization
                    </Button>
                  </div>
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Shield className="size-4" /> Reactivate
                    </p>
                    <Button
                      size="sm"
                      disabled={reactivateMutation.isPending}
                      onClick={() => reactivateMutation.mutate()}
                    >
                      Reactivate
                    </Button>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <p className="text-sm font-medium">Override plan</p>
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
                    <Button size="sm" disabled={planMutation.isPending} onClick={() => planMutation.mutate()}>
                      Apply plan
                    </Button>
                  </div>
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <CreditCard className="size-4" /> Billing credit
                    </p>
                    <Label htmlFor="credit-note">Note</Label>
                    <Input
                      id="credit-note"
                      value={creditNote}
                      onChange={(e) => setCreditNote(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={creditNote.trim().length < 3 || creditMutation.isPending}
                      onClick={() => creditMutation.mutate()}
                    >
                      Record credit &amp; downgrade
                    </Button>
                  </div>
                </div>
              </Panel>

              <Panel title="Recent audit log">
                {detail.auditLog.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No events yet.</p>
                ) : (
                  <ul className="max-h-64 space-y-2 overflow-y-auto text-xs">
                    {detail.auditLog.map((e) => (
                      <li key={e.id} className="rounded border border-border px-2 py-1.5">
                        <span className="font-medium">{e.action}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          — {e.actor_email || "system"} · {new Date(e.created_at).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </>
          ) : null}
        </div>
      </div>
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
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-secondary/40 ${
          selected ? "bg-primary/5" : ""
        }`}
      >
        <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{org.name}</p>
          <p className="text-xs text-muted-foreground">
            {org.plan_tier} · {org.member_count} members
          </p>
        </div>
        {!org.is_active || org.platform_suspended ? (
          <Pill tone="danger">Off</Pill>
        ) : (
          <Pill tone="success">Live</Pill>
        )}
      </button>
    </li>
  );
}
