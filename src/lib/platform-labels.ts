/** Human-readable labels for platform console (never show raw system keys in UI). */

const AUDIT_LABELS: Record<string, string> = {
  "platform.suspend": "Organization suspended",
  "platform.reactivate": "Organization reactivated",
  "platform.plan_override": "Plan changed",
  "platform.refund": "Billing credit recorded",
  "platform.notes": "Support notes updated",
  "platform.member_update": "Team member updated",
  "platform.admin_add": "Platform admin added",
  "platform.admin_remove": "Platform admin removed",
  "platform.support_access": "Support access logged",
  "org.disable": "Workspace disabled",
  "org.export": "Workspace exported",
  "org.delete": "Workspace deleted",
  "account.delete": "Account deleted",
  "team.invite": "Team invite sent",
  "team.invite_revoke": "Invite revoked",
  "team.update": "Team member updated",
  "team.create": "Team member created",
  "billing.openai_key_save": "OpenAI key saved",
  "billing.openai_key_remove": "OpenAI key removed",
  "billing.checkout": "Checkout started",
};

export function labelAuditAction(action: string): string {
  return AUDIT_LABELS[action] || action.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function labelBillingStatus(status: string | null | undefined): string {
  const v = String(status || "active").toLowerCase();
  if (v === "past_due") return "Past due";
  if (v === "cancelled" || v === "canceled") return "Cancelled";
  if (v === "trialing") return "Trial";
  return "Active";
}

export function labelPlanTier(tier: string | null | undefined): string {
  const v = String(tier || "free").toLowerCase();
  if (v === "starter") return "Starter";
  if (v === "pro") return "Pro";
  if (v === "enterprise") return "Enterprise";
  return "Free";
}

export function formatInr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}
