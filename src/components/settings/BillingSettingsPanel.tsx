import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, KeyRound, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { EmptyState, Panel, Pill } from "@/components/shared/ui-kit";
import {
  createRazorpayCheckout,
  getOrgBillingSummary,
  removeOrgOpenAiKey,
  saveOrgOpenAiKey,
  type BillingSummary,
} from "@/server/org-billing";
import { isUnlimited } from "@/lib/plans";

const QUERY_KEY = ["org-billing"] as const;

function usagePercent(used: number, cap: number | null): number {
  if (cap == null || cap <= 0) return 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

function formatInr(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function UsageMeter({
  label,
  used,
  cap,
  unit,
}: {
  label: string;
  used: number;
  cap: number | null;
  unit: string;
}) {
  const pct = usagePercent(used, cap);
  const capLabel = isUnlimited(cap) ? "Unlimited" : `${cap!.toLocaleString("en-IN")} ${unit}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {used.toLocaleString("en-IN")} / {capLabel}
        </span>
      </div>
      {!isUnlimited(cap) ? (
        <Progress value={pct} className={pct >= 90 ? "[&>div]:bg-destructive" : undefined} />
      ) : (
        <p className="text-xs text-muted-foreground">No cap on this plan</p>
      )}
    </div>
  );
}

export function BillingSettingsPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getOrgBillingSummary(),
  });
  const [apiKey, setApiKey] = useState("");

  const checkoutMutation = useMutation({
    mutationFn: (planTier: "starter" | "pro") => createRazorpayCheckout({ data: { planTier } }),
    onSuccess: (data) => {
      window.open(data.checkoutUrl, "_blank", "noopener,noreferrer");
      toast.success("Checkout opened in a new tab");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Checkout failed"),
  });

  const saveKeyMutation = useMutation({
    mutationFn: () => saveOrgOpenAiKey({ data: { apiKey: apiKey.trim() } }),
    onSuccess: async (data) => {
      setApiKey("");
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success(`OpenAI key saved (${data.hint})`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save key"),
  });

  const removeKeyMutation = useMutation({
    mutationFn: () => removeOrgOpenAiKey(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("OpenAI key removed — platform billing applies again");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not remove key"),
  });

  const data = query.data as BillingSummary | undefined;

  if (query.isLoading) {
    return (
      <Panel title="Billing & usage">
        <p className="text-sm text-muted-foreground">Loading billing…</p>
      </Panel>
    );
  }

  if (query.isError || !data) {
    return (
      <Panel title="Billing & usage">
        <EmptyState
          title="Could not load billing"
          description="Run supabase/migrations/041_billing.sql in the Supabase SQL Editor, then refresh."
        />
      </Panel>
    );
  }

  const statusTone =
    data.billingStatus === "active"
      ? "success"
      : data.billingStatus === "past_due"
        ? "danger"
        : "neutral";

  return (
    <>
      <Panel
        title="Plan & usage"
        description="Hard caps apply to platform-billed AI and WhatsApp. Add your own OpenAI key to bypass the AI cap."
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Pill tone="info">{data.planLabel}</Pill>
          <Pill tone={statusTone} dot>
            {data.billingStatus.replace("_", " ")}
          </Pill>
          {data.hasOwnOpenAiKey ? <Pill tone="success">BYOK OpenAI</Pill> : null}
        </div>

        <div className="space-y-4">
          <UsageMeter
            label="AI spend (this month)"
            used={Math.round(data.usage.aiSpendInr)}
            cap={data.limits.monthlyAiSpendCapInr}
            unit="INR"
          />
          <UsageMeter
            label="WhatsApp messages"
            used={data.usage.whatsappMessages}
            cap={data.limits.monthlyWhatsAppCap}
            unit="msgs"
          />
          <UsageMeter
            label="Team seats"
            used={data.usage.seatsUsed + data.usage.pendingInvites}
            cap={data.limits.maxSeats}
            unit="seats"
          />
        </div>

        {data.billingPeriodEnd ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Billing period ends {new Date(data.billingPeriodEnd).toLocaleDateString()}
          </p>
        ) : null}
      </Panel>

      <Panel title="Upgrade plan">
        <div className="grid gap-3 sm:grid-cols-2">
          {data.plans
            .filter((p) => p.tier === "starter" || p.tier === "pro")
            .map((plan) => (
              <div
                key={plan.tier}
                className={`rounded-lg border p-4 ${plan.current ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{plan.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {plan.priceInr != null ? `${formatInr(plan.priceInr)}/mo` : "Custom"}
                    </p>
                  </div>
                  {plan.current ? <Pill tone="success">Current</Pill> : null}
                </div>
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <li>
                    AI:{" "}
                    {isUnlimited(plan.monthlyAiSpendCapInr)
                      ? "Unlimited"
                      : formatInr(plan.monthlyAiSpendCapInr!)}
                    /mo
                  </li>
                  <li>
                    WhatsApp:{" "}
                    {isUnlimited(plan.monthlyWhatsAppCap)
                      ? "Unlimited"
                      : `${plan.monthlyWhatsAppCap!.toLocaleString("en-IN")}/mo`}
                  </li>
                  <li>
                    Seats: {isUnlimited(plan.maxSeats) ? "Unlimited" : plan.maxSeats}
                  </li>
                </ul>
                {!plan.current ? (
                  <Button
                    size="sm"
                    className="mt-4 w-full gap-1.5"
                    variant={plan.tier === "pro" ? "default" : "outline"}
                    disabled={checkoutMutation.isPending || !data.razorpayConfigured}
                    onClick={() =>
                      checkoutMutation.mutate(plan.tier as "starter" | "pro")
                    }
                  >
                    {checkoutMutation.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CreditCard className="size-3.5" />
                    )}
                    {data.razorpayConfigured ? "Upgrade" : "Contact support"}
                  </Button>
                ) : null}
              </div>
            ))}
        </div>
        {!data.razorpayConfigured ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Razorpay checkout is not configured on the server. Set{" "}
            <code className="rounded bg-muted px-1">RAZORPAY_KEY_ID</code>,{" "}
            <code className="rounded bg-muted px-1">RAZORPAY_KEY_SECRET</code>, and plan IDs to
            enable self-serve upgrades.
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Your OpenAI key (optional)"
        description="When set, AI requests use your key and do not count against the platform AI spend cap."
      >
        {data.hasOwnOpenAiKey ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <KeyRound className="size-4 text-muted-foreground" />
              <span>
                Key on file: <span className="font-mono">{data.openAiKeyHint}</span>
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={removeKeyMutation.isPending}
              onClick={() => removeKeyMutation.mutate()}
            >
              Remove key
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="openai-key">OpenAI API key</Label>
              <Input
                id="openai-key"
                type="password"
                autoComplete="off"
                placeholder="sk-…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!apiKey.trim().startsWith("sk-") || saveKeyMutation.isPending}
              onClick={() => saveKeyMutation.mutate()}
            >
              {saveKeyMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Save key
            </Button>
          </div>
        )}
      </Panel>
    </>
  );
}
