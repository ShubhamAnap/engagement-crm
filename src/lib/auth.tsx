import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase";
import { AuthContext, type AuthState } from "@/lib/auth-context";
import { hexToOklchCss, contrastingForegroundOklch } from "@/lib/color";
import { useTheme } from "@/lib/theme";
import { syncStaffAccessCookie } from "@/lib/staff-access-cookie";
import { toast } from "sonner";
import { initialsFromName, type Profile, type SessionUser } from "@/lib/types";
import {
  DEFAULT_NEW_USER_PERMISSIONS,
  effectivePermissions,
  normalizePermissions,
} from "@/lib/permissions";

const BRAND_STYLE_KEYS = [
  "--primary",
  "--primary-foreground",
  "--ring",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-ring",
  "--chart-1",
  "--accent",
];

async function fetchSessionUser(userId: string): Promise<SessionUser | null> {
  const supabase = getBrowserSupabase();

  const baseSelect =
    "id, email, full_name, role, phone, job_title, avatar_url, org_id, organizations(id, name, short_name, plan)";
  const brandedSelect =
    "id, email, full_name, role, phone, job_title, avatar_url, org_id, permissions, is_active, organizations(id, name, short_name, plan, logo_url, brand_primary, is_active)";

  let data: Record<string, unknown> | null = null;
  let error: { message?: string } | null = null;

  const full = await supabase.from("profiles").select(brandedSelect).eq("id", userId).maybeSingle();

  if (full.error) {
    // Missing branding/permissions columns — fall back
    const fallback = await supabase.from("profiles").select(baseSelect).eq("id", userId).maybeSingle();
    data = fallback.data as Record<string, unknown> | null;
    error = fallback.error;
  } else {
    data = full.data as Record<string, unknown> | null;
    error = null;
  }

  if (error) throw error;
  if (!data) return null;

  const orgRaw = data.organizations as unknown;
  const org = (Array.isArray(orgRaw) ? orgRaw[0] : orgRaw) as {
    id: string;
    name: string;
    short_name: string;
    plan: string;
    logo_url?: string | null;
    brand_primary?: string | null;
    is_active?: boolean;
  } | null;

  if (!org) return null;
  if ((org as { is_active?: boolean }).is_active === false) {
    throw new Error("ORG_DISABLED");
  }

  const role = data.role as SessionUser["role"];
  const permissions = effectivePermissions({
    role,
    permissions: data.permissions ?? DEFAULT_NEW_USER_PERMISSIONS,
  });

  return {
    id: data.id as string,
    email: data.email as string,
    fullName: data.full_name as string,
    role,
    initials: initialsFromName(data.full_name as string),
    phone: (data.phone as string | null) ?? null,
    jobTitle: (data.job_title as string | null) ?? null,
    avatarUrl: (data.avatar_url as string | null) ?? null,
    permissions: normalizePermissions(permissions),
    isActive: data.is_active !== false,
    org: {
      id: org.id,
      name: org.name,
      short: org.short_name,
      plan: org.plan,
      logoUrl: org.logo_url ?? null,
      brandPrimary: org.brand_primary ?? null,
      isActive: org.is_active !== false,
    },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { resolved } = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    const supabase = getBrowserSupabase();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      syncStaffAccessCookie(data.session?.access_token);
      setBootstrapping(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      syncStaffAccessCookie(next?.access_token);
      setBootstrapping(false);
      void queryClient.invalidateQueries({ queryKey: ["auth", "profile"] });
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  const userId = session?.user?.id ?? null;

  const profileQuery = useQuery({
    queryKey: ["auth", "profile", userId],
    enabled: Boolean(userId),
    queryFn: () => fetchSessionUser(userId!),
    staleTime: 60_000,
    retry: (count, error) => {
      if (error instanceof Error && error.message === "ORG_DISABLED") return false;
      return count < 1;
    },
  });

  // Org brand accent is the only primary when set. Convert hex → oklch so mixes/tints stay clean.
  useEffect(() => {
    const hex = profileQuery.data?.org.brandPrimary?.trim();
    const root = document.documentElement;
    if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      for (const key of BRAND_STYLE_KEYS) root.style.removeProperty(key);
      return;
    }
    const oklch = hexToOklchCss(hex, { minLightness: resolved === "dark" ? 0.68 : undefined });
    const fg =
      resolved === "dark" ? "oklch(0.16 0.03 254)" : contrastingForegroundOklch(hex);
    root.style.setProperty("--primary", oklch);
    root.style.setProperty("--primary-foreground", fg);
    root.style.setProperty("--ring", oklch);
    root.style.setProperty("--sidebar-primary", oklch);
    root.style.setProperty("--sidebar-primary-foreground", fg);
    root.style.setProperty("--sidebar-ring", oklch);
    root.style.setProperty("--chart-1", oklch);
    root.style.setProperty("--accent", "color-mix(in oklab, var(--primary) 14%, var(--background))");
    return () => {
      for (const key of BRAND_STYLE_KEYS) root.style.removeProperty(key);
    };
  }, [profileQuery.data?.org.brandPrimary, resolved]);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getBrowserSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getBrowserSupabase();
    await supabase.auth.signOut();
    syncStaffAccessCookie(null);
    queryClient.removeQueries({ queryKey: ["auth"] });
  }, [queryClient]);

  useEffect(() => {
    if (profileQuery.error instanceof Error && profileQuery.error.message === "ORG_DISABLED") {
      toast.error("This workspace has been disabled. Contact support.");
      void signOut();
    }
  }, [profileQuery.error, signOut]);

  const refreshProfile = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["auth", "profile"] });
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile: profileQuery.data ?? null,
      loading: bootstrapping || (Boolean(userId) && profileQuery.isLoading),
      signIn,
      signOut,
      refreshProfile,
    }),
    [
      session,
      profileQuery.data,
      profileQuery.isLoading,
      bootstrapping,
      userId,
      signIn,
      signOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Narrow helper when UI needs a guaranteed profile. */
export function useSessionUser(): SessionUser | null {
  return useAuth().profile;
}

export type { Profile, AuthState };
export type { User, Session };
