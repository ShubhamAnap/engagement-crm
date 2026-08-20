/**
 * Platform super-admin auth (cross-tenant /platform console).
 */
import { createServiceSupabase } from "@/lib/supabase";
import { requireAuthUser, type StaffAuth } from "@/server/staff-auth";

function forbidden(message = "Platform admin access required"): never {
  const err = new Error(message);
  (err as Error & { statusCode: number }).statusCode = 403;
  throw err;
}

function envPlatformEmails(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS || "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function isPlatformAdminUser(userId: string, email?: string | null): Promise<boolean> {
  if (email && envPlatformEmails().has(email.trim().toLowerCase())) {
    return true;
  }
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return Boolean(email && envPlatformEmails().has(email.trim().toLowerCase()));
    }
    console.error("platform admin check failed", error.message);
    return false;
  }
  return Boolean(data?.user_id);
}

/** Signed-in user who is a platform super-admin. */
export async function requirePlatformAdmin(): Promise<StaffAuth> {
  const auth = await requireAuthUser();
  if (!auth.profile) forbidden("Complete workspace setup before using platform console.");
  const ok = await isPlatformAdminUser(auth.user.id, auth.user.email || auth.profile.email);
  if (!ok) forbidden();
  return { user: auth.user, profile: auth.profile };
}
