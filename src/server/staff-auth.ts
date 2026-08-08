/**
 * Staff auth for privileged createServerFn handlers.
 * Browser sessions live in localStorage — middleware forwards Bearer + optional cookie.
 */
import { createClient, type User } from "@supabase/supabase-js";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
import { createServiceSupabase } from "@/lib/supabase";
import { STAFF_ACCESS_COOKIE } from "@/server/staff-auth-public";

export type StaffProfile = {
  id: string;
  org_id: string;
  role: string;
  email: string;
};

export type StaffAuth = {
  user: User;
  profile: StaffProfile;
};

function unauthorized(message = "Unauthorized"): never {
  const err = new Error(message);
  (err as Error & { statusCode: number }).statusCode = 401;
  throw err;
}

function extractAccessToken(): string | null {
  const authHeader = getRequestHeader("authorization") || getRequestHeader("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const raw = getCookie(STAFF_ACCESS_COOKIE)?.trim();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Validate JWT and org membership. Call from handlers or via global middleware. */
export async function requireStaffUser(): Promise<StaffAuth> {
  const token = extractAccessToken();
  if (!token) unauthorized();

  let user: User | null = null;

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

  if (url && anon) {
    try {
      const anonClient = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data } = await anonClient.auth.getUser(token);
      user = data.user ?? null;
    } catch (err) {
      console.warn("staff auth anon getUser failed, trying service role", err);
    }
  }

  const service = createServiceSupabase();
  if (!user) {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) unauthorized();
    user = data.user;
  }

  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id, org_id, role, email")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.org_id) unauthorized("No organization profile");

  return {
    user,
    profile: profile as StaffProfile,
  };
}
