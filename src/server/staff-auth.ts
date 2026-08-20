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
  impersonation?: {
    homeOrgId: string;
    targetOrgId: string;
    targetOrgName: string;
    expiresAt: string;
  };
};

function unauthorized(message = "Unauthorized"): never {
  const err = new Error(message);
  (err as Error & { statusCode: number }).statusCode = 401;
  throw err;
}

function forbidden(message: string): never {
  const err = new Error(message);
  (err as Error & { statusCode: number }).statusCode = 403;
  throw err;
}

const PROFILE_COLUMNS = "id, org_id, role, email, is_active, permissions";
const PROFILE_COLUMNS_WITH_ORG = `${PROFILE_COLUMNS}, organizations(is_active, platform_suspended)`;

type ProfileRow = Record<string, unknown> & {
  organizations?: { is_active?: boolean; platform_suspended?: boolean } | Array<{
    is_active?: boolean;
    platform_suspended?: boolean;
  }> | null;
};

/**
 * Load the profile plus its workspace status in one round trip.
 * Falls back to the plain columns when migration 042 has not been applied yet.
 */
async function loadProfileWithOrg(
  service: ReturnType<typeof createServiceSupabase>,
  userId: string,
): Promise<{ profile: ProfileRow | null; orgChecked: boolean }> {
  const full = await service
    .from("profiles")
    .select(PROFILE_COLUMNS_WITH_ORG)
    .eq("id", userId)
    .maybeSingle();

  if (!full.error) {
    return { profile: full.data as ProfileRow | null, orgChecked: true };
  }

  const basic = await service
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (basic.error) unauthorized();
  return { profile: basic.data as ProfileRow | null, orgChecked: false };
}

/** Suspended workspaces keep their data but lose API access until reactivated. */
function assertWorkspaceLive(profile: ProfileRow): void {
  const rel = profile.organizations;
  const org = Array.isArray(rel) ? rel[0] : rel;
  if (!org) return;
  if (org.is_active === false || org.platform_suspended === true) {
    forbidden("This workspace is suspended. Contact support to reactivate it.");
  }
}

function toStaffProfile(profile: ProfileRow): StaffProfile {
  const { organizations: _org, ...rest } = profile;
  return rest as unknown as StaffProfile;
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

  const { profile } = await loadProfileWithOrg(service, user.id);

  if (!profile?.org_id) unauthorized("No organization profile");
  if (profile.is_active === false) unauthorized("Account disabled");
  assertWorkspaceLive(profile);

  return {
    user,
    profile: toStaffProfile(profile),
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

  const { profile } = await loadProfileWithOrg(service, user.id);

  if (profile?.is_active === false) unauthorized("Account disabled");
  if (profile?.org_id) assertWorkspaceLive(profile);

  return {
    user,
    profile: profile?.org_id ? toStaffProfile(profile) : null,
  };
}

/** Validate JWT and org membership. Call from handlers or via global middleware. */
export async function requireStaffUser(): Promise<StaffAuth> {
  const token = tryStaffToken();
  if (!token) unauthorized();
  const auth = await validateStaffToken(token);
  const { applyImpersonationToStaffAuth } = await import("@/server/platform-impersonation");
  return applyImpersonationToStaffAuth(auth);
}

/** Signed-in user without requiring a profiles row (OAuth onboarding / invite accept). */
export async function requireAuthUser(): Promise<{ user: User; profile: StaffProfile | null }> {
  const token = tryStaffToken();
  if (!token) unauthorized();
  return validateAuthToken(token);
}
