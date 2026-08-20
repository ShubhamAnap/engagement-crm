/**
 * Team invites + OAuth bootstrap (accept pending invite, provision workspace).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { normalizeAuthEmail } from "@/lib/auth-email";
import {
  DEFAULT_NEW_USER_PERMISSIONS,
  normalizePermissions,
  type PermissionKey,
} from "@/lib/permissions";
import { provisionOrganization } from "@/server/org-provision";
import { recordAuditEvent } from "@/server/audit-log";
import { inviteOnlyMode } from "@/server/signup-rate-limit";
import { assertSeatAllowed } from "@/server/org-usage";
import { requireAuthUser, requireStaffUser } from "@/server/staff-auth";

function appBaseUrl(): string {
  return String(process.env.VITE_APP_URL || "http://localhost:8080").replace(/\/$/, "");
}

function forbidden(message = "Only Admin can manage invites"): never {
  const err = new Error(message);
  (err as Error & { statusCode: number }).statusCode = 403;
  throw err;
}

async function requireAdmin() {
  const auth = await requireStaffUser();
  if (auth.profile.role !== "Admin") forbidden();
  return auth;
}

export type PendingInvite = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
};

export async function findPendingInviteForEmail(
  email: string,
): Promise<(PendingInvite & { org_id: string; permissions: PermissionKey[] }) | null> {
  const supabase = createServiceSupabase();
  const normalized = normalizeAuthEmail(email);
  const { data, error } = await supabase
    .from("org_invites")
    .select("id, org_id, email, full_name, role, permissions, status, expires_at, created_at")
    .eq("email", normalized)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  return {
    ...(data as PendingInvite),
    org_id: String(data.org_id),
    permissions: normalizePermissions(data.permissions),
  };
}

async function acceptInviteForUser(options: {
  userId: string;
  email: string;
  fullName: string;
}): Promise<{ orgId: string } | null> {
  const invite = await findPendingInviteForEmail(options.email);
  if (!invite) return null;

  const supabase = createServiceSupabase();
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", options.userId)
    .maybeSingle();
  if (existing) return { orgId: invite.org_id };

  const { error: profileErr } = await supabase.from("profiles").insert({
    id: options.userId,
    org_id: invite.org_id,
    email: normalizeAuthEmail(options.email),
    full_name: options.fullName.trim() || invite.full_name || options.email.split("@")[0],
    role: invite.role || "Agent",
    permissions: invite.permissions.length ? invite.permissions : [...DEFAULT_NEW_USER_PERMISSIONS],
    is_active: true,
  });
  if (profileErr) throw new Error(profileErr.message);

  await supabase
    .from("org_invites")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  return { orgId: invite.org_id };
}

export type AuthBootstrapResult =
  | { status: "ready" }
  | { status: "onboarding"; email: string; fullName: string }
  | { status: "invite_required"; email: string };

/** After OAuth or magic link — create profile from invite or send to onboarding. */
export const bootstrapAuthSession = createServerFn({ method: "POST" }).handler(async () => {
  const { user, profile } = await requireAuthUser();

  if (profile?.org_id) {
    const supabase = createServiceSupabase();
    const { data: org } = await supabase
      .from("organizations")
      .select("is_active")
      .eq("id", profile.org_id)
      .maybeSingle();
    if (org?.is_active === false) {
      throw new Error("This workspace has been disabled. Contact support.");
    }
    return { status: "ready" as const };
  }

  const email = normalizeAuthEmail(user.email || profile?.email || "");
  const fullName =
    String(user.user_metadata?.full_name || user.user_metadata?.name || "").trim() ||
    email.split("@")[0];

  const accepted = await acceptInviteForUser({ userId: user.id, email, fullName });
  if (accepted) return { status: "ready" as const };

  if (inviteOnlyMode()) {
    return { status: "invite_required" as const, email };
  }

  return { status: "onboarding" as const, email, fullName };
});

export const completeOAuthOnboarding = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orgName: z.string().min(2).max(160),
      fullName: z.string().min(2).max(120).optional(),
    }),
  )
  .handler(async ({ data }) => {
    if (inviteOnlyMode()) {
      throw new Error("New workspaces are invite-only. Ask your admin for an invite.");
    }

    const auth = await requireAuthUser();
    const supabase = createServiceSupabase();
    const { data: existing } = await supabase
      .from("profiles")
      .select("id, org_id")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (existing?.org_id) return { ok: true as const, orgId: existing.org_id };

    const email = normalizeAuthEmail(auth.user.email || "");
    const fullName =
      data.fullName?.trim() ||
      String(auth.user.user_metadata?.full_name || "").trim() ||
      email.split("@")[0];

    const result = await provisionOrganization(supabase, {
      orgName: data.orgName.trim(),
      fullName,
      email,
      authUserId: auth.user.id,
    });

    return { ok: true as const, orgId: result.orgId };
  });

export const listOrgInvites = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await requireAdmin();
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("org_invites")
    .select("id, email, full_name, role, status, expires_at, created_at")
    .eq("org_id", auth.profile.org_id)
    .in("status", ["pending", "accepted"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as PendingInvite[];
});

export const inviteTeamMember = createServerFn({ method: "POST" })
  .validator(
    z.object({
      fullName: z.string().min(1).max(120),
      email: z.string().email().max(200),
      permissions: z.array(z.string()).max(32).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    await assertSeatAllowed(auth.profile.org_id);
    const supabase = createServiceSupabase();
    const email = normalizeAuthEmail(data.email);
    const fullName = data.fullName.trim();
    const permissions = normalizePermissions(
      data.permissions?.length ? data.permissions : DEFAULT_NEW_USER_PERMISSIONS,
    );

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id, org_id")
      .eq("email", email)
      .maybeSingle();
    if (existingProfile) {
      if (existingProfile.org_id === auth.profile.org_id) {
        throw new Error("This person is already on your team.");
      }
      throw new Error("This email already belongs to another workspace.");
    }

    await supabase
      .from("org_invites")
      .update({ status: "revoked" })
      .eq("org_id", auth.profile.org_id)
      .eq("email", email)
      .eq("status", "pending");

    const { data: inviteRow, error: inviteErr } = await supabase
      .from("org_invites")
      .insert({
        org_id: auth.profile.org_id,
        email,
        full_name: fullName,
        role: "Agent",
        permissions,
        invited_by: auth.profile.id,
        status: "pending",
      })
      .select("id")
      .single();
    if (inviteErr) throw new Error(inviteErr.message);

    const redirectTo = `${appBaseUrl()}/accept-invite`;
    const { data: invited, error: authErr } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: fullName, invite_id: inviteRow.id, org_id: auth.profile.org_id },
    });
    if (authErr) {
      await supabase.from("org_invites").update({ status: "revoked" }).eq("id", inviteRow.id);
      throw new Error(authErr.message);
    }

    void recordAuditEvent({
      orgId: auth.profile.org_id,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "team.invite",
      resourceType: "org_invite",
      resourceId: inviteRow.id,
      metadata: { email, fullName },
    });

    if (invited.user) {
      await acceptInviteForUser({
        userId: invited.user.id,
        email,
        fullName,
      });
    }

    return { ok: true as const, inviteId: inviteRow.id };
  });

export const revokeOrgInvite = createServerFn({ method: "POST" })
  .validator(z.object({ inviteId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("org_invites")
      .update({ status: "revoked" })
      .eq("id", data.inviteId)
      .eq("org_id", auth.profile.org_id)
      .eq("status", "pending");
    if (error) throw new Error(error.message);

    void recordAuditEvent({
      orgId: auth.profile.org_id,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "team.invite_revoke",
      resourceType: "org_invite",
      resourceId: data.inviteId,
    });

    return { ok: true as const };
  });

/** Called from /accept-invite after the user sets their password. */
export const completeInviteAcceptance = createServerFn({ method: "POST" }).handler(async () => {
  const { user } = await requireAuthUser();
  const email = normalizeAuthEmail(user.email || "");
  const fullName =
    String(user.user_metadata?.full_name || "").trim() || email.split("@")[0];

  const accepted = await acceptInviteForUser({
    userId: user.id,
    email,
    fullName,
  });
  if (!accepted) {
    throw new Error("No pending invite found for this email. Ask your admin to resend.");
  }
  return { ok: true as const, orgId: accepted.orgId };
});
