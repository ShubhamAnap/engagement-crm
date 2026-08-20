/**
 * Platform admin tenant impersonation (support mode).
 * Session lives in platform_impersonation_sessions; RLS helpers follow target org.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { recordAuditEvent } from "@/server/audit-log";
import { requirePlatformAdmin } from "@/server/platform-auth";
import type { StaffAuth } from "@/server/staff-auth";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export type ImpersonationStatus = {
  active: boolean;
  targetOrgId: string | null;
  targetOrgName: string | null;
  targetOrgShort: string | null;
  targetPlan: string | null;
  targetLogoUrl: string | null;
  targetBrandPrimary: string | null;
  homeOrgId: string | null;
  expiresAt: string | null;
};

function emptyStatus(): ImpersonationStatus {
  return {
    active: false,
    targetOrgId: null,
    targetOrgName: null,
    targetOrgShort: null,
    targetPlan: null,
    targetLogoUrl: null,
    targetBrandPrimary: null,
    homeOrgId: null,
    expiresAt: null,
  };
}

/** Apply active DB impersonation onto staff auth (service-role lookup). */
export async function applyImpersonationToStaffAuth(auth: StaffAuth): Promise<StaffAuth> {
  const supabase = createServiceSupabase();
  const { data: session } = await supabase
    .from("platform_impersonation_sessions")
    .select("target_org_id, home_org_id, expires_at")
    .eq("user_id", auth.user.id)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!session?.target_org_id) return auth;
  if (session.target_org_id === auth.profile.org_id) return auth;

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", session.target_org_id)
    .maybeSingle();
  if (!org) return auth;

  return {
    ...auth,
    profile: {
      ...auth.profile,
      org_id: session.target_org_id,
      role: "Admin",
    },
    impersonation: {
      homeOrgId: session.home_org_id || auth.profile.org_id,
      targetOrgId: session.target_org_id,
      targetOrgName: org.name,
      expiresAt: session.expires_at,
    },
  };
}

export const getPlatformImpersonationStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<ImpersonationStatus> => {
    const { requireStaffUser } = await import("@/server/staff-auth");
    let auth;
    try {
      auth = await requireStaffUser();
    } catch {
      return emptyStatus();
    }

    const supabase = createServiceSupabase();
    const { data: session, error } = await supabase
      .from("platform_impersonation_sessions")
      .select("target_org_id, home_org_id, expires_at")
      .eq("user_id", auth.user.id)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return emptyStatus();
      console.error("impersonation status", error.message);
      return emptyStatus();
    }
    if (!session?.target_org_id) return emptyStatus();

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, short_name, plan, logo_url, brand_primary")
      .eq("id", session.target_org_id)
      .maybeSingle();

    if (!org) return emptyStatus();

    return {
      active: true,
      targetOrgId: org.id,
      targetOrgName: org.name,
      targetOrgShort: org.short_name,
      targetPlan: org.plan,
      targetLogoUrl: org.logo_url ?? null,
      targetBrandPrimary: org.brand_primary ?? null,
      homeOrgId: session.home_org_id || auth.profile.org_id,
      expiresAt: session.expires_at,
    };
  },
);

export const startPlatformImpersonation = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orgId: z.string().uuid(),
      note: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    const supabase = createServiceSupabase();

    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("id, name, short_name, plan, logo_url, brand_primary")
      .eq("id", data.orgId)
      .maybeSingle();
    if (orgErr) throw new Error(orgErr.message);
    if (!org) throw new Error("Organization not found");

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const { error } = await supabase.from("platform_impersonation_sessions").upsert({
      user_id: auth.user.id,
      target_org_id: org.id,
      home_org_id: auth.profile.org_id,
      started_at: new Date().toISOString(),
      expires_at: expiresAt,
      note: data.note?.trim() || null,
    });
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        throw new Error("Run migration 043_platform_impersonation.sql in Supabase first.");
      }
      throw new Error(error.message);
    }

    void recordAuditEvent({
      orgId: org.id,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.impersonate_start",
      resourceType: "organization",
      resourceId: org.id,
      metadata: { note: data.note?.trim() || null, expiresAt },
    });

    return {
      ok: true as const,
      orgId: org.id,
      orgName: org.name,
      expiresAt,
    };
  });

export const stopPlatformImpersonation = createServerFn({ method: "POST" }).handler(async () => {
  const { requireStaffUser } = await import("@/server/staff-auth");
  const auth = await requireStaffUser();
  const supabase = createServiceSupabase();

  const { data: existing } = await supabase
    .from("platform_impersonation_sessions")
    .select("target_org_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("platform_impersonation_sessions")
    .delete()
    .eq("user_id", auth.user.id);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { ok: true as const };
    }
    throw new Error(error.message);
  }

  if (existing?.target_org_id) {
    void recordAuditEvent({
      orgId: existing.target_org_id,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.impersonate_stop",
      resourceType: "organization",
      resourceId: existing.target_org_id,
    });
  }

  return { ok: true as const };
});
