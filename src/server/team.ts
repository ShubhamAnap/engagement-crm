/**
 * Admin Team management — create users, tick section privileges, disable, reset password.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { recordAuditEvent } from "@/server/audit-log";
import { requireStaffUser } from "@/server/staff-auth";
import {
  DEFAULT_NEW_USER_PERMISSIONS,
  allPermissionKeys,
  normalizePermissions,
  type PermissionKey,
} from "@/lib/permissions";

const permissionsSchema = z.array(z.string()).max(allPermissionKeys().length + 4);

function forbidden(message = "Only Admin can manage team members"): never {
  const err = new Error(message);
  (err as Error & { statusCode: number }).statusCode = 403;
  throw err;
}

async function requireAdmin() {
  const auth = await requireStaffUser();
  if (auth.profile.role !== "Admin") forbidden();
  return auth;
}

export type TeamMemberRow = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  permissions: PermissionKey[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  is_self: boolean;
};

function mapMember(
  row: Record<string, unknown>,
  selfId: string,
): TeamMemberRow {
  const role = String(row.role || "Agent");
  const permissions =
    role === "Admin" ? allPermissionKeys() : normalizePermissions(row.permissions);
  return {
    id: String(row.id),
    email: String(row.email || ""),
    full_name: String(row.full_name || ""),
    role,
    permissions: permissions.length ? permissions : [...DEFAULT_NEW_USER_PERMISSIONS],
    is_active: row.is_active !== false,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    is_self: String(row.id) === selfId,
  };
}

export const listTeamMembers = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await requireAdmin();
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, permissions, is_active, created_at, updated_at")
    .eq("org_id", auth.profile.org_id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapMember(row as Record<string, unknown>, auth.profile.id));
});

export const createTeamMember = createServerFn({ method: "POST" })
  .validator(
    z.object({
      fullName: z.string().min(1).max(120),
      email: z.string().email().max(200),
      password: z.string().min(8).max(72),
      permissions: permissionsSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    const supabase = createServiceSupabase();
    const email = data.email.trim().toLowerCase();
    const fullName = data.fullName.trim();
    const permissions = normalizePermissions(
      data.permissions?.length ? data.permissions : DEFAULT_NEW_USER_PERMISSIONS,
    );

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createError || !created.user) {
      throw new Error(createError?.message || "Could not create auth user");
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: created.user.id,
      org_id: auth.profile.org_id,
      email,
      full_name: fullName,
      role: "Agent",
      permissions,
      is_active: true,
    });

    if (profileError) {
      await supabase.auth.admin.deleteUser(created.user.id).catch(() => undefined);
      throw new Error(profileError.message);
    }

    return {
      id: created.user.id,
      email,
      full_name: fullName,
      permissions,
    };
  });

export const updateTeamMember = createServerFn({ method: "POST" })
  .validator(
    z.object({
      userId: z.string().uuid(),
      fullName: z.string().min(1).max(120).optional(),
      permissions: permissionsSchema.optional(),
      isActive: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    const supabase = createServiceSupabase();

    const { data: target, error: loadError } = await supabase
      .from("profiles")
      .select("id, role, email, full_name, permissions, is_active")
      .eq("id", data.userId)
      .eq("org_id", auth.profile.org_id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!target) throw new Error("User not found");

    if (target.id === auth.profile.id) {
      if (data.isActive === false) forbidden("You cannot disable your own account");
    }

    if (String(target.role) === "Admin" && target.id !== auth.profile.id) {
      // Do not rewrite another Admin's permissions via this panel
      if (data.permissions) forbidden("Cannot change another Admin's section access");
    }

    const patch: Record<string, unknown> = {};
    if (data.fullName !== undefined) patch.full_name = data.fullName.trim();
    if (data.permissions !== undefined && String(target.role) !== "Admin") {
      patch.permissions = normalizePermissions(data.permissions);
    }
    if (data.isActive !== undefined) patch.is_active = data.isActive;

    if (Object.keys(patch).length) {
      const { error: updError } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", data.userId)
        .eq("org_id", auth.profile.org_id);
      if (updError) throw new Error(updError.message);
    }

    if (data.isActive !== undefined) {
      const { error: banError } = await supabase.auth.admin.updateUserById(data.userId, {
        ban_duration: data.isActive ? "none" : "876600h",
      });
      if (banError) {
        console.warn("auth ban toggle failed", banError.message);
      }
    }

    if (Object.keys(patch).length || data.isActive !== undefined) {
      void recordAuditEvent({
        orgId: auth.profile.org_id,
        actorId: auth.profile.id,
        actorEmail: auth.profile.email,
        action: "team.update",
        resourceType: "profile",
        resourceId: data.userId,
        metadata: { fields: Object.keys(patch), isActive: data.isActive },
      });
    }

    return { ok: true };
  });

export const resetTeamMemberPassword = createServerFn({ method: "POST" })
  .validator(
    z.object({
      userId: z.string().uuid(),
      password: z.string().min(8).max(72),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    const supabase = createServiceSupabase();
    const { data: target, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", data.userId)
      .eq("org_id", auth.profile.org_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!target) throw new Error("User not found");

    const { error: updError } = await supabase.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (updError) throw new Error(updError.message);
    return { ok: true };
  });

export const copyTeamMemberAccess = createServerFn({ method: "POST" })
  .validator(
    z.object({
      targetUserId: z.string().uuid(),
      sourceUserId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    if (data.targetUserId === auth.profile.id) {
      forbidden("Cannot overwrite your own Admin access via copy");
    }
    const supabase = createServiceSupabase();
    const { data: rows, error } = await supabase
      .from("profiles")
      .select("id, role, permissions")
      .eq("org_id", auth.profile.org_id)
      .in("id", [data.targetUserId, data.sourceUserId]);
    if (error) throw new Error(error.message);
    const source = (rows || []).find((r) => r.id === data.sourceUserId);
    const target = (rows || []).find((r) => r.id === data.targetUserId);
    if (!source || !target) throw new Error("User not found");
    if (String(target.role) === "Admin") forbidden("Cannot change Admin permissions");

    const permissions =
      String(source.role) === "Admin"
        ? allPermissionKeys()
        : normalizePermissions(source.permissions);

    const { error: updError } = await supabase
      .from("profiles")
      .update({ permissions })
      .eq("id", data.targetUserId)
      .eq("org_id", auth.profile.org_id);
    if (updError) throw new Error(updError.message);
    return { ok: true, permissions };
  });
