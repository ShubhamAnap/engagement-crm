/**
 * Staff auth for privileged createServerFn handlers.
 * Browser sessions live in localStorage — middleware forwards Bearer + optional cookie.
 */
import { createClient, type User } from "@supabase/supabase-js";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
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

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function createAnonSupabase() {
  const url = requireEnv(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    "SUPABASE_URL",
  );
  const anon = requireEnv(
    process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY,
    "SUPABASE_ANON_KEY",
  );
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

  const anon = createAnonSupabase();
  const { data: userData, error: userError } = await anon.auth.getUser(token);
  if (userError || !userData.user) unauthorized();

  const url = requireEnv(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, "SUPABASE_URL");
  const anonKey = requireEnv(
    process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY,
    "SUPABASE_ANON_KEY",
  );

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("id, org_id, role, email")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || !profile?.org_id) unauthorized("No organization profile");

  return {
    user: userData.user,
    profile: profile as StaffProfile,
  };
}
