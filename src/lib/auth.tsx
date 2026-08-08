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
import { syncStaffAccessCookie } from "@/lib/staff-access-cookie";
import { initialsFromName, type Profile, type SessionUser } from "@/lib/types";

function contrastingForeground(hex: string): string {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? "#0A0F0C" : "#FFFFFF";
}

async function fetchSessionUser(userId: string): Promise<SessionUser | null> {
  const supabase = getBrowserSupabase();

  const baseSelect =
    "id, email, full_name, role, phone, job_title, avatar_url, org_id, organizations(id, name, short_name, plan)";
  const brandedSelect =
    "id, email, full_name, role, phone, job_title, avatar_url, org_id, organizations(id, name, short_name, plan, logo_url, brand_primary)";

  let data: Record<string, unknown> | null = null;
  let error: { message?: string } | null = null;

  const full = await supabase.from("profiles").select(brandedSelect).eq("id", userId).maybeSingle();

  if (full.error) {
    // Missing branding columns (migration 015 not run) or schema cache — fall back
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
  } | null;

  if (!org) return null;

  return {
    id: data.id as string,
    email: data.email as string,
    fullName: data.full_name as string,
    role: data.role as SessionUser["role"],
    initials: initialsFromName(data.full_name as string),
    phone: (data.phone as string | null) ?? null,
    jobTitle: (data.job_title as string | null) ?? null,
    avatarUrl: (data.avatar_url as string | null) ?? null,
    org: {
      id: org.id,
      name: org.name,
      short: org.short_name,
      plan: org.plan,
      logoUrl: org.logo_url ?? null,
      brandPrimary: org.brand_primary ?? null,
    },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
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
    retry: 1,
  });

  // Apply optional org brand accent over theme primary
  useEffect(() => {
    const hex = profileQuery.data?.org.brandPrimary?.trim();
    const root = document.documentElement;
    const keys = ["--primary", "--ring", "--sidebar-primary", "--sidebar-ring", "--chart-1"];
    if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      for (const key of keys) root.style.removeProperty(key);
      root.style.removeProperty("--primary-foreground");
      root.style.removeProperty("--sidebar-primary-foreground");
      return;
    }
    const fg = contrastingForeground(hex);
    for (const key of keys) root.style.setProperty(key, hex);
    root.style.setProperty("--primary-foreground", fg);
    root.style.setProperty("--sidebar-primary-foreground", fg);
    return () => {
      for (const key of keys) root.style.removeProperty(key);
      root.style.removeProperty("--primary-foreground");
      root.style.removeProperty("--sidebar-primary-foreground");
    };
  }, [profileQuery.data?.org.brandPrimary]);

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
