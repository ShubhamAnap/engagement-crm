/**
 * Platform super-admin console API (cross-tenant).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { normalizePlanTier, planLabelForTier, type PlanTier } from "@/lib/plans";
import { recordAuditEvent } from "@/server/audit-log";
import { invalidateOrgUsageCache, getOrgUsageSnapshot } from "@/server/org-usage";
import { requirePlatformAdmin } from "@/server/platform-auth";

export type PlatformOrgRow = {
  id: string;
  name: string;
  short_name: string;
  plan: string;
  plan_tier: string;
  billing_status: string;
  is_active: boolean;
  platform_suspended: boolean;
  member_count: number;
  created_at: string;
};

export const checkPlatformAccess = createServerFn({ method: "GET" }).handler(async () => {
  await requirePlatformAdmin();
  return { ok: true as const };
});

export const listPlatformOrganizations = createServerFn({ method: "GET" }).handler(async () => {
  await requirePlatformAdmin();
  const supabase = createServiceSupabase();
  const { data: orgs, error } = await supabase
    .from("organizations")
    .select(
      "id, name, short_name, plan, plan_tier, billing_status, is_active, platform_suspended, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);

  const rows = orgs ?? [];
  const counts = await Promise.all(
    rows.map(async (org) => {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("org_id", org.id);
      return { orgId: org.id, count: count ?? 0 };
    }),
  );
  const countMap = new Map(counts.map((c) => [c.orgId, c.count]));

  return rows.map((org) => ({
    id: org.id,
    name: org.name,
    short_name: org.short_name,
    plan: org.plan,
    plan_tier: org.plan_tier || "free",
    billing_status: org.billing_status || "active",
    is_active: org.is_active !== false,
    platform_suspended: org.platform_suspended === true,
    member_count: countMap.get(org.id) ?? 0,
    created_at: org.created_at,
  })) satisfies PlatformOrgRow[];
});

export const getPlatformOrganization = createServerFn({ method: "GET" })
  .validator(z.object({ orgId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    const supabase = createServiceSupabase();

    const { data: org, error } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", data.orgId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!org) throw new Error("Organization not found");

    const [usage, profiles, channels, audit, billingEvents] = await Promise.all([
      getOrgUsageSnapshot(data.orgId, { fresh: true }),
      supabase
        .from("profiles")
        .select("id, email, full_name, role, is_active, created_at")
        .eq("org_id", data.orgId)
        .order("created_at", { ascending: true }),
      supabase
        .from("channels")
        .select("id, type, name, status, is_enabled, health, updated_at")
        .eq("org_id", data.orgId),
      supabase
        .from("audit_events")
        .select("id, action, actor_email, resource_type, resource_id, metadata, created_at")
        .eq("org_id", data.orgId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("billing_events")
        .select("id, event_type, external_id, created_at")
        .eq("org_id", data.orgId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    return {
      organization: org,
      usage,
      team: profiles.data ?? [],
      channels: channels.data ?? [],
      auditLog: audit.data ?? [],
      billingEvents: billingEvents.data ?? [],
      viewerEmail: auth.profile.email,
    };
  });

export const platformSuspendOrganization = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orgId: z.string().uuid(),
      reason: z.string().max(500).optional(),
      notes: z.string().max(2000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    const supabase = createServiceSupabase();
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("organizations")
      .update({
        is_active: false,
        platform_suspended: true,
        disabled_at: now,
        disabled_reason: data.reason?.trim() || "Suspended by platform admin",
        platform_notes: data.notes?.trim() || null,
      })
      .eq("id", data.orgId);
    if (error) throw new Error(error.message);

    await supabase
      .from("org_invites")
      .update({ status: "revoked" })
      .eq("org_id", data.orgId)
      .eq("status", "pending");

    void recordAuditEvent({
      orgId: data.orgId,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.suspend",
      resourceType: "organization",
      resourceId: data.orgId,
      metadata: { reason: data.reason, notes: data.notes },
    });

    invalidateOrgUsageCache(data.orgId);
    return { ok: true as const, suspendedAt: now };
  });

export const platformReactivateOrganization = createServerFn({ method: "POST" })
  .validator(z.object({ orgId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    const supabase = createServiceSupabase();

    const { error } = await supabase
      .from("organizations")
      .update({
        is_active: true,
        platform_suspended: false,
        disabled_at: null,
        disabled_reason: null,
      })
      .eq("id", data.orgId);
    if (error) throw new Error(error.message);

    void recordAuditEvent({
      orgId: data.orgId,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.reactivate",
      resourceType: "organization",
      resourceId: data.orgId,
    });

    return { ok: true as const };
  });

export const platformSetOrganizationPlan = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orgId: z.string().uuid(),
      planTier: z.enum(["free", "starter", "pro", "enterprise"]),
      billingStatus: z.enum(["active", "past_due", "cancelled"]).optional(),
      note: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    const tier = normalizePlanTier(data.planTier) as PlanTier;
    const supabase = createServiceSupabase();

    const patch: Record<string, unknown> = {
      plan_tier: tier,
      plan: planLabelForTier(tier),
    };
    if (data.billingStatus) patch.billing_status = data.billingStatus;

    const { error } = await supabase.from("organizations").update(patch).eq("id", data.orgId);
    if (error) throw new Error(error.message);

    void recordAuditEvent({
      orgId: data.orgId,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.plan_override",
      resourceType: "organization",
      resourceId: data.orgId,
      metadata: { planTier: tier, billingStatus: data.billingStatus, note: data.note },
    });

    invalidateOrgUsageCache(data.orgId);
    return { ok: true as const, planTier: tier };
  });

/** Manual billing credit — downgrade to free and cancel subscription ref (refund handled offline). */
export const platformIssueBillingCredit = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orgId: z.string().uuid(),
      note: z.string().min(3).max(500),
      downgradeToFree: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    const supabase = createServiceSupabase();

    const patch: Record<string, unknown> = {
      billing_status: "cancelled",
    };
    if (data.downgradeToFree !== false) {
      patch.plan_tier = "free";
      patch.plan = planLabelForTier("free");
      patch.razorpay_subscription_id = null;
    }

    const { error } = await supabase.from("organizations").update(patch).eq("id", data.orgId);
    if (error) throw new Error(error.message);

    void recordAuditEvent({
      orgId: data.orgId,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.refund",
      resourceType: "organization",
      resourceId: data.orgId,
      metadata: { note: data.note, downgradeToFree: data.downgradeToFree !== false },
    });

    invalidateOrgUsageCache(data.orgId);
    return { ok: true as const };
  });

export const listOrgAuditEvents = createServerFn({ method: "GET" })
  .validator(z.object({ limit: z.number().int().min(1).max(100).optional() }))
  .handler(async ({ data }) => {
    const { requireStaffUser } = await import("@/server/staff-auth");
    const auth = await requireStaffUser();
    if (auth.profile.role !== "Admin") {
      const err = new Error("Only Admin can view audit log");
      (err as Error & { statusCode: number }).statusCode = 403;
      throw err;
    }

    const supabase = createServiceSupabase();
    const { data: rows, error } = await supabase
      .from("audit_events")
      .select("id, action, actor_email, resource_type, resource_id, metadata, created_at")
      .eq("org_id", auth.profile.org_id)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return [];
      throw new Error(error.message);
    }
    return rows ?? [];
  });
