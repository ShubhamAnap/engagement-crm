import {
  createContext,
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
import { initialsFromName, type Profile, type SessionUser } from "@/lib/types";

type AuthState = {
  session: Session | null;
  user: User | null;
  profile: SessionUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

async function fetchSessionUser(userId: string): Promise<SessionUser | null> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, phone, job_title, avatar_url, org_id, organizations(id, name, short_name, plan)")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const orgRaw = data.organizations as unknown;
  const org = (Array.isArray(orgRaw) ? orgRaw[0] : orgRaw) as {
    id: string;
    name: string;
    short_name: string;
    plan: string;
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
      setBootstrapping(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
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
  });

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getBrowserSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getBrowserSupabase();
    await supabase.auth.signOut();
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

export type { Profile };
