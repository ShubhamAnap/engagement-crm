/**
 * Staff auth for privileged createServerFn handlers.
 * Browser sessions live in localStorage — middleware forwards Bearer + optional cookie.
 */
import { createClient, type User } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase";

export type StaffProfile = {
  id: string;
  org_id: string;
  role: string;
  email: string;
  is_active?: boolean;
  permissions?: unknown;
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

type StaffTokenStore = import("node:async_hooks").AsyncLocalStorage<string | null>;
let staffTokenStore: StaffTokenStore | undefined;

async function getStaffTokenStore(): Promise<StaffTokenStore> {
  if (staffTokenStore) return staffTokenStore;
  const mod = await import("node:async_hooks");
  staffTokenStore = new mod.AsyncLocalStorage<string | null>();
  return staffTokenStore;
}

function tryStaffToken(): string | null | undefined {
  return staffTokenStore?.getStore();
}

export async function runWithStaffToken<T>(token: string | null, fn: () => T): Promise<T> {
  const store = await getStaffTokenStore();
  return store.run(token, fn);
}

async function validateStaffToken(token: string): Promise<StaffAuth> {
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
    .select("id, org_id, role, email, is_active, permissions")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.org_id) unauthorized("No organization profile");
  if (profile.is_active === false) unauthorized("Account disabled");

  return {
    user,
    profile: profile as StaffProfile,
  };
}

async function validateAuthToken(token: string): Promise<{ user: User; profile: StaffProfile | null }> {
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
      console.warn("auth getUser failed, trying service role", err);
    }
  }

  const service = createServiceSupabase();
  if (!user) {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) unauthorized();
    user = data.user;
  }

  const { data: profile } = await service
    .from("profiles")
    .select("id, org_id, role, email, is_active, permissions")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.is_active === false) unauthorized("Account disabled");

  return {
    user,
    profile: profile?.org_id ? (profile as StaffProfile) : null,
  };
}

/** Validate JWT and org membership. Call from handlers or via global middleware. */
export async function requireStaffUser(): Promise<StaffAuth> {
  const token = tryStaffToken();
  if (!token) unauthorized();
  return validateStaffToken(token);
}

/** Signed-in user without requiring a profiles row (OAuth onboarding / invite accept). */
export async function requireAuthUser(): Promise<{ user: User; profile: StaffProfile | null }> {
  const token = tryStaffToken();
  if (!token) unauthorized();
  return validateAuthToken(token);
}
