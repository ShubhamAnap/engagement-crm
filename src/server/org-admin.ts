/**
 * Org admin: disable/export/delete workspace + self-delete account.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { recordAuditEvent } from "@/server/audit-log";
import { requireStaffUser } from "@/server/staff-auth";

function forbidden(message = "Only Admin can manage workspace lifecycle"): never {
  const err = new Error(message);
  (err as Error & { statusCode: number }).statusCode = 403;
  throw err;
}

async function requireAdmin() {
  const auth = await requireStaffUser();
  if (auth.profile.role !== "Admin") forbidden();
  return auth;
}

async function removeStoragePrefix(
  bucket: string,
  prefix: string,
  cursor = "",
): Promise<void> {
  const supabase = createServiceSupabase();
  const folder = cursor ? `${prefix}${cursor}` : prefix;
  const { data, error } = await supabase.storage.from(bucket).list(folder, {
    limit: 100,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) {
    console.warn(`storage cleanup skipped for ${bucket}/${folder}: ${error.message}`);
    return;
  }

  const files: string[] = [];
  for (const item of data ?? []) {
    const child = cursor ? `${cursor}${item.name}` : item.name;
    if (!("id" in item) || !item.id) {
      await removeStoragePrefix(bucket, prefix, `${child}/`);
    } else {
      files.push(`${prefix}${child}`);
    }
  }
  if (files.length > 0) {
    await supabase.storage.from(bucket).remove(files).catch(() => undefined);
  }
}

async function deleteOrgAssets(orgId: string): Promise<void> {
  const prefix = `${orgId}/`;
  await Promise.all([
    removeStoragePrefix("knowledge", prefix),
    removeStoragePrefix("branding", prefix),
  ]);
}

export const disableOrganization = createServerFn({ method: "POST" })
  .validator(z.object({ reason: z.string().max(500).optional() }))
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    const supabase = createServiceSupabase();
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("organizations")
      .update({
        is_active: false,
        disabled_at: now,
        disabled_reason: data.reason?.trim() || "Disabled by admin",
      })
      .eq("id", auth.profile.org_id);
    if (error) throw new Error(error.message);

    void recordAuditEvent({
      orgId: auth.profile.org_id,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "org.disable",
      resourceType: "organization",
      resourceId: auth.profile.org_id,
      metadata: { reason: data.reason?.trim() || "Disabled by admin" },
    });

    await supabase
      .from("org_invites")
      .update({ status: "revoked" })
      .eq("org_id", auth.profile.org_id)
      .eq("status", "pending");

    return { ok: true as const, disabledAt: now };
  });

export const exportOrganizationData = createServerFn({ method: "POST" }).handler(async () => {
  const auth = await requireAdmin();
  const orgId = auth.profile.org_id;
  const supabase = createServiceSupabase();

  const [
    org,
    profiles,
    leads,
    customers,
    conversations,
    products,
    channels,
    automations,
  ] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    supabase.from("profiles").select("id, email, full_name, role, is_active, created_at").eq("org_id", orgId),
    supabase.from("leads").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(5000),
    supabase.from("customers").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(5000),
    supabase
      .from("conversations")
      .select("id, channel, status, visitor_name, visitor_email, visitor_phone, created_at, updated_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase.from("products").select("*").eq("org_id", orgId).limit(2000),
    supabase.from("channels").select("id, type, name, status, is_enabled, config").eq("org_id", orgId),
    supabase.from("automations").select("id, name, status, trigger_type, run_count").eq("org_id", orgId),
  ]);

  void recordAuditEvent({
    orgId,
    actorId: auth.profile.id,
    actorEmail: auth.profile.email,
    action: "org.export",
    resourceType: "organization",
    resourceId: orgId,
  });

  return {
    exportedAt: new Date().toISOString(),
    orgId,
    organization: org.data,
    team: profiles.data ?? [],
    leads: leads.data ?? [],
    customers: customers.data ?? [],
    conversations: conversations.data ?? [],
    products: products.data ?? [],
    channels: (channels.data ?? []).map((c) => ({
      ...c,
      config: typeof c.config === "object" ? "[redacted secrets]" : c.config,
    })),
    automations: automations.data ?? [],
    note: "Messages and files are not included in this export. Contact support for full backup.",
  };
});

export const deleteMyAccount = createServerFn({ method: "POST" })
  .validator(z.object({ confirmText: z.string().max(64) }))
  .handler(async ({ data }) => {
    if (data.confirmText.trim().toUpperCase() !== "DELETE ACCOUNT") {
      throw new Error("Type DELETE ACCOUNT to confirm.");
    }

    const auth = await requireStaffUser();
    const supabase = createServiceSupabase();

    if (auth.profile.role === "Admin") {
      const [{ count: adminCount }, { count: memberCount }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("org_id", auth.profile.org_id)
          .eq("role", "Admin")
          .eq("is_active", true),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("org_id", auth.profile.org_id),
      ]);

      if ((adminCount ?? 0) <= 1 && (memberCount ?? 0) > 1) {
        throw new Error("Assign another active Admin before deleting your own account.");
      }
      if ((memberCount ?? 0) <= 1) {
        throw new Error("You are the last member. Delete the entire workspace instead.");
      }
    }

    void recordAuditEvent({
      orgId: auth.profile.org_id,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "account.delete",
      resourceType: "profile",
      resourceId: auth.profile.id,
    });

    const { error } = await supabase.auth.admin.deleteUser(auth.profile.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteOrganizationPermanently = createServerFn({ method: "POST" })
  .validator(
    z.object({
      confirmText: z.string().max(64),
      confirmName: z.string().max(160),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    const supabase = createServiceSupabase();

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("id", auth.profile.org_id)
      .maybeSingle();
    if (orgError || !org) throw new Error(orgError?.message || "Workspace not found");

    if (data.confirmText.trim().toUpperCase() !== "DELETE WORKSPACE") {
      throw new Error("Type DELETE WORKSPACE to confirm.");
    }
    if (data.confirmName.trim() !== org.name) {
      throw new Error("Workspace name does not match.");
    }

    const { data: users, error: usersError } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("org_id", org.id);
    if (usersError) throw new Error(usersError.message);

    void recordAuditEvent({
      orgId: org.id,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "org.delete",
      resourceType: "organization",
      resourceId: org.id,
      metadata: { memberCount: users?.length ?? 0 },
    });

    await deleteOrgAssets(org.id);
    for (const user of users ?? []) {
      await supabase.auth.admin.deleteUser(String(user.id)).catch((err) => {
        console.warn(`delete user failed for ${user.email}:`, err);
      });
    }

    const { error: deleteOrgError } = await supabase.from("organizations").delete().eq("id", org.id);
    if (deleteOrgError) throw new Error(deleteOrgError.message);

    return { ok: true as const };
  });
