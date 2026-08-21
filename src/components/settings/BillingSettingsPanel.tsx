import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, KeyRound, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { EmptyState, Panel, Pill } from "@/components/shared/ui-kit";
import { describeLoadError } from "@/lib/feature-setup";
import {
  createRazorpayCheckout,
  getOrgBillingSummary,
  removeOrgOpenAiKey,
  saveOrgOpenAiKey,
  type BillingSummary,
} from "@/server/org-billing";
import { createStripeCheckout } from "@/server/org-billing-stripe";
import { isNearLimit, isUnlimited, SOFT_LIMIT_RATIO } from "@/lib/plans";
import { SUPPORT_EMAIL } from "@/lib/public-site";

const QUERY_KEY = ["org-billing"] as const;

/** One line naming whichever meters are close to their cap, so upgrades are not a surprise. */
function nearLimitNote(data: BillingSummary): string | null {
  const near: string[] = [];
  if (isNearLimit(data.usage.aiSpendInr, data.limits.monthlyAiSpendCapInr)) near.push("AI spend");
  if (isNearLimit(data.usage.whatsappMessages, data.limits.monthlyWhatsAppCap)) {
    near.push("WhatsApp messages");
  }
  if (isNearLimit(data.usage.seatsUsed + data.usage.pendingInvites, data.limits.maxSeats)) {
    near.push("team seats");
  }
  if (near.length === 0) return null;
  const pct = Math.round(SOFT_LIMIT_RATIO * 100);
  return `You are past ${pct}% of your monthly limit for ${near.join(" and ")}. Upgrade before you hit the cap to avoid interruption.`;
}

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

  const stripeCheckoutMutation = useMutation({
    mutationFn: (planTier: "starter" | "pro") => createStripeCheckout({ data: { planTier } }),
    onSuccess: (data) => {
      window.open(data.checkoutUrl, "_blank", "noopener,noreferrer");
      toast.success("Stripe checkout opened in a new tab");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Stripe checkout failed"),
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
          description={describeLoadError(query.error, "Billing", "041_billing.sql")}
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
        description="Monthly caps apply to platform-billed AI and WhatsApp. Add your own OpenAI key to bypass the AI cap."
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Pill tone="info">{data.planLabel}</Pill>
          <Pill tone={statusTone} dot>
            {data.billingStatus.replace("_", " ")}
          </Pill>
          {data.hasOwnOpenAiKey ? <Pill tone="success">BYOK OpenAI</Pill> : null}
          {data.trialActive && data.trialEndsAt ? (
            <Pill tone="info">Trial until {new Date(data.trialEndsAt).toLocaleDateString()}</Pill>
          ) : null}
          {data.hasCustomLimits ? <Pill tone="primary">Contract limits</Pill> : null}
        </div>

        {data.pastDueGraceUntil ? (
          <div className="mb-4 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm">
            <p className="font-medium text-destructive">Payment failed</p>
            <p className="mt-0.5 text-muted-foreground">
              Everything keeps working until{" "}
              {new Date(data.pastDueGraceUntil).toLocaleDateString()}. Update your payment method
              before then to avoid interruption.
            </p>
          </div>
        ) : null}

        {data.usageGraceUntil && new Date(data.usageGraceUntil) > new Date() ? (
          <div className="mb-4 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2.5 text-sm">
            <p className="font-medium text-warning">Over your monthly limit</p>
            <p className="mt-0.5 text-muted-foreground">
              We are still sending until{" "}
              {new Date(data.usageGraceUntil).toLocaleDateString()}. Upgrade to keep going after
              that.
            </p>
          </div>
        ) : null}

        {nearLimitNote(data) ? (
          <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-sm text-muted-foreground">
            {nearLimitNote(data)}
          </div>
        ) : null}

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
                      {plan.priceUsd != null && plan.priceUsd > 0 ? (
                        <span className="block text-xs">or ${plan.priceUsd}/mo USD</span>
                      ) : null}
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
                  <div className="mt-4 space-y-2">
                    <Button
                      size="sm"
                      className="w-full gap-1.5"
                      variant={plan.tier === "pro" ? "default" : "outline"}
                      disabled={
                        checkoutMutation.isPending ||
                        stripeCheckoutMutation.isPending ||
                        !data.razorpayConfigured
                      }
                      onClick={() =>
                        checkoutMutation.mutate(plan.tier as "starter" | "pro")
                      }
                    >
                      {checkoutMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <CreditCard className="size-3.5" />
                      )}
                      {data.razorpayConfigured ? "Upgrade (INR)" : "INR checkout off"}
                    </Button>
                    {data.stripeConfigured ? (
                      <Button
                        size="sm"
                        className="w-full gap-1.5"
                        variant="outline"
                        disabled={
                          checkoutMutation.isPending || stripeCheckoutMutation.isPending
                        }
                        onClick={() =>
                          stripeCheckoutMutation.mutate(plan.tier as "starter" | "pro")
                        }
                      >
                        {stripeCheckoutMutation.isPending ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <CreditCard className="size-3.5" />
                        )}
                        Upgrade (USD)
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
        </div>
        {!data.razorpayConfigured && !data.stripeConfigured ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Self-serve upgrades are not switched on yet. Email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">
              {SUPPORT_EMAIL}
            </a>{" "}
            and we will move your workspace to the plan you need.
          </p>
        ) : !data.razorpayConfigured ? (
          <p className="mt-3 text-xs text-muted-foreground">
            INR (Razorpay) is off; USD Stripe checkout is available above.
          </p>
        ) : null}
        {data.hasCustomLimits ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Your limits come from your agreement with us, so they may differ from the plans above.
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Payment history"
        description="Payments and invoices recorded against this workspace."
      >
        {data.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No payments yet. Invoices appear here after your first charge.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data.invoices.map((inv) => {
              const failed = `${inv.status || ""} ${inv.eventType}`.toLowerCase().includes("fail");
              return (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {inv.amount == null ? "Payment" : formatInr(inv.amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleDateString()}
                      {inv.invoiceId ? ` · ${inv.invoiceId}` : ""}
                    </p>
                  </div>
                  <Pill tone={failed ? "danger" : "success"}>{failed ? "Failed" : "Paid"}</Pill>
                </li>
              );
            })}
          </ul>
        )}
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
