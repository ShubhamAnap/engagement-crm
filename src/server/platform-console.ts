/**
 * Platform super-admin console API (cross-tenant).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import {
  normalizePlanTier,
  parseCustomLimits,
  planLabelForTier,
  type PlanTier,
} from "@/lib/plans";
import { FEATURE_KEYS } from "@/lib/features";
import { recordAuditEvent } from "@/server/audit-log";
import { loadBillingInvoices } from "@/server/org-billing";
import { invalidateOrgUsageCache, getOrgUsageSnapshot } from "@/server/org-usage";
import { requirePlatformAdmin } from "@/server/platform-auth";

/** Platform admins can read migration state, so tell them plainly which one is missing. */
function migrationHint(error: { code?: string; message: string }, feature: string): string {
  if (error.code === "42703" || error.code === "PGRST204") {
    return `${feature} needs migration 045_billing_ops.sql applied to this database.`;
  }
  return error.message;
}

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
  const auth = await requirePlatformAdmin();
  return { ok: true as const, email: auth.profile.email, userId: auth.profile.id };
});

export type PlatformOverviewStats = {
  totalOrgs: number;
  liveOrgs: number;
  suspendedOrgs: number;
  pastDueOrgs: number;
  totalMembers: number;
  byPlan: Record<string, number>;
};

export const getPlatformOverview = createServerFn({ method: "GET" }).handler(async () => {
  await requirePlatformAdmin();
  const supabase = createServiceSupabase();
  const { data: orgs, error } = await supabase
    .from("organizations")
    .select("id, plan_tier, billing_status, is_active, platform_suspended");
  if (error) throw new Error(error.message);

  const rows = orgs ?? [];
  const byPlan: Record<string, number> = { free: 0, starter: 0, pro: 0, enterprise: 0 };
  let liveOrgs = 0;
  let suspendedOrgs = 0;
  let pastDueOrgs = 0;

  for (const org of rows) {
    const tier = normalizePlanTier(org.plan_tier);
    byPlan[tier] = (byPlan[tier] || 0) + 1;
    if (org.platform_suspended === true || org.is_active === false) suspendedOrgs += 1;
    else liveOrgs += 1;
    if (String(org.billing_status || "") === "past_due") pastDueOrgs += 1;
  }

  const { count: totalMembers } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true });

  return {
    totalOrgs: rows.length,
    liveOrgs,
    suspendedOrgs,
    pastDueOrgs,
    totalMembers: totalMembers ?? 0,
    byPlan,
  } satisfies PlatformOverviewStats;
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
    .limit(500);
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

    const [usage, profiles, channels, audit, billingEvents, invoices] = await Promise.all([
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
      loadBillingInvoices(data.orgId, 12),
    ]);

    return {
      organization: org,
      usage,
      team: profiles.data ?? [],
      channels: channels.data ?? [],
      auditLog: audit.data ?? [],
      billingEvents: billingEvents.data ?? [],
      invoices,
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

/**
 * Turn modules on or off for one workspace.
 *
 * Only disabled keys are stored, so the column stays readable and a workspace with an
 * empty object behaves exactly like one that was never touched.
 */
export const platformSetFeatureFlags = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orgId: z.string().uuid(),
      flags: z.record(z.enum(["ai", "whatsapp", "marketplace_sync"]), z.boolean()),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    const supabase = createServiceSupabase();

    const stored: Record<string, boolean> = {};
    for (const key of FEATURE_KEYS) {
      if (data.flags[key] === false) stored[key] = false;
    }

    const { error } = await supabase
      .from("organizations")
      .update({ feature_flags: stored })
      .eq("id", data.orgId);
    if (error) throw new Error(migrationHint(error, "Feature flags"));

    void recordAuditEvent({
      orgId: data.orgId,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.feature_flags",
      resourceType: "organization",
      resourceId: data.orgId,
      metadata: { disabled: Object.keys(stored) },
    });

    invalidateOrgUsageCache(data.orgId);
    return { ok: true as const, disabled: Object.keys(stored) };
  });

/**
 * Trial window and negotiated contract terms.
 *
 * An empty string clears a field — the dialog cannot send `undefined` for "leave alone"
 * and "erase" separately, so blank means clear.
 */
export const platformSetContract = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orgId: z.string().uuid(),
      trialEndsAt: z.string().max(40).nullable().optional(),
      contractReference: z.string().max(200).nullable().optional(),
      contractEndsAt: z.string().max(40).nullable().optional(),
      customLimits: z
        .object({
          monthlyAiSpendCapInr: z.number().min(0).nullable().optional(),
          monthlyWhatsAppCap: z.number().min(0).nullable().optional(),
          maxSeats: z.number().min(0).nullable().optional(),
        })
        .nullable()
        .optional(),
      note: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    const supabase = createServiceSupabase();

    const patch: Record<string, unknown> = {};
    if (data.trialEndsAt !== undefined) patch.trial_ends_at = data.trialEndsAt || null;
    if (data.contractReference !== undefined) {
      patch.contract_reference = data.contractReference || null;
    }
    if (data.contractEndsAt !== undefined) patch.contract_ends_at = data.contractEndsAt || null;
    if (data.customLimits !== undefined) {
      const limits = data.customLimits ? parseCustomLimits(data.customLimits) : {};
      patch.custom_limits = Object.keys(limits).length > 0 ? limits : null;
    }
    if (Object.keys(patch).length === 0) return { ok: true as const };

    const { error } = await supabase.from("organizations").update(patch).eq("id", data.orgId);
    if (error) throw new Error(migrationHint(error, "Trials and contracts"));

    void recordAuditEvent({
      orgId: data.orgId,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.contract_update",
      resourceType: "organization",
      resourceId: data.orgId,
      metadata: { ...patch, note: data.note },
    });

    invalidateOrgUsageCache(data.orgId);
    return { ok: true as const };
  });

/** Clear an open cap-overage grace window, e.g. after the customer upgrades. */
export const platformResetUsageGrace = createServerFn({ method: "POST" })
  .validator(z.object({ orgId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("organizations")
      .update({ usage_grace_until: null, usage_grace_month: null, past_due_since: null })
      .eq("id", data.orgId);
    if (error) throw new Error(migrationHint(error, "Usage grace"));

    void recordAuditEvent({
      orgId: data.orgId,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.grace_reset",
      resourceType: "organization",
      resourceId: data.orgId,
    });

    invalidateOrgUsageCache(data.orgId);
    return { ok: true as const };
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

export const listPlatformAuditEvents = createServerFn({ method: "GET" })
  .validator(
    z.object({
      limit: z.number().int().min(1).max(100).optional(),
      orgId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requirePlatformAdmin();
    const supabase = createServiceSupabase();
    let query = supabase
      .from("audit_events")
      .select("id, org_id, action, actor_email, resource_type, resource_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.orgId) query = query.eq("org_id", data.orgId);
    const { data: rows, error } = await query;
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return [];
      throw new Error(error.message);
    }

    const orgIds = [...new Set((rows ?? []).map((r) => r.org_id).filter(Boolean))] as string[];
    const nameMap = new Map<string, string>();
    if (orgIds.length) {
      const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", orgIds);
      for (const o of orgs ?? []) nameMap.set(o.id, o.name);
    }

    return (rows ?? []).map((r) => ({
      ...r,
      org_name: r.org_id ? nameMap.get(r.org_id) || null : null,
    }));
  });

export const platformUpdateOrgNotes = createServerFn({ method: "POST" })
  .validator(z.object({ orgId: z.string().uuid(), notes: z.string().max(4000) }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    const supabase = createServiceSupabase();
    const notes = data.notes.trim() || null;
    const { error } = await supabase
      .from("organizations")
      .update({ platform_notes: notes })
      .eq("id", data.orgId);
    if (error) throw new Error(error.message);

    void recordAuditEvent({
      orgId: data.orgId,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.notes",
      resourceType: "organization",
      resourceId: data.orgId,
      metadata: { length: notes?.length ?? 0 },
    });

    return { ok: true as const };
  });

export const platformSetMemberActive = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orgId: z.string().uuid(),
      userId: z.string().uuid(),
      isActive: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    if (data.userId === auth.profile.id) {
      throw new Error("You cannot disable your own account from here.");
    }
    const supabase = createServiceSupabase();
    const { data: profile, error: pe } = await supabase
      .from("profiles")
      .select("id, org_id, email, role")
      .eq("id", data.userId)
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (pe) throw new Error(pe.message);
    if (!profile) throw new Error("Member not found in this organization.");

    const { error } = await supabase
      .from("profiles")
      .update({ is_active: data.isActive })
      .eq("id", data.userId)
      .eq("org_id", data.orgId);
    if (error) throw new Error(error.message);

    void recordAuditEvent({
      orgId: data.orgId,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.member_update",
      resourceType: "profile",
      resourceId: data.userId,
      metadata: { isActive: data.isActive, email: profile.email },
    });

    return { ok: true as const };
  });

export const listPlatformAdmins = createServerFn({ method: "GET" }).handler(async () => {
  await requirePlatformAdmin();
  const supabase = createServiceSupabase();
  const { data: rows, error } = await supabase
    .from("platform_admins")
    .select("user_id, created_at")
    .order("created_at", { ascending: true });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(error.message);
  }

  const ids = (rows ?? []).map((r) => r.user_id);
  if (!ids.length) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name, org_id")
    .in("id", ids);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  return (rows ?? []).map((r) => {
    const p = profileMap.get(r.user_id);
    return {
      userId: r.user_id,
      email: p?.email || "",
      fullName: p?.full_name || "",
      orgId: p?.org_id || null,
      createdAt: r.created_at,
    };
  });
});

export const addPlatformAdminByEmail = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().email().max(200) }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    const email = data.email.trim().toLowerCase();
    const supabase = createServiceSupabase();
    const { data: profile, error: pe } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .ilike("email", email)
      .maybeSingle();
    if (pe) throw new Error(pe.message);
    if (!profile) throw new Error("No user found with that email. They must sign up first.");

    const { error } = await supabase.from("platform_admins").upsert({ user_id: profile.id });
    if (error) throw new Error(error.message);

    void recordAuditEvent({
      orgId: null,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.admin_add",
      resourceType: "platform_admin",
      resourceId: profile.id,
      metadata: { email: profile.email },
    });

    return { ok: true as const, userId: profile.id, email: profile.email };
  });

export const removePlatformAdmin = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    if (data.userId === auth.profile.id) {
      throw new Error("You cannot remove your own platform admin access.");
    }
    const supabase = createServiceSupabase();
    const { error } = await supabase.from("platform_admins").delete().eq("user_id", data.userId);
    if (error) throw new Error(error.message);

    void recordAuditEvent({
      orgId: null,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.admin_remove",
      resourceType: "platform_admin",
      resourceId: data.userId,
    });

    return { ok: true as const };
  });

export const platformLogSupportAccess = createServerFn({ method: "POST" })
  .validator(z.object({ orgId: z.string().uuid(), note: z.string().max(500).optional() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    void recordAuditEvent({
      orgId: data.orgId,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.support_access",
      resourceType: "organization",
      resourceId: data.orgId,
      metadata: { note: data.note?.trim() || null },
    });
    return { ok: true as const, viewerOrgId: auth.profile.org_id };
  });
