import { createContext } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { SessionUser } from "@/lib/types";

export type AuthState = {
  session: Session | null;
  user: User | null;
  profile: SessionUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

/**
 * Kept in a separate module so Vite HMR of auth.tsx does not recreate
 * the Context identity (which breaks "useAuth must be used within AuthProvider").
 */
export const AuthContext = createContext<AuthState | null>(null);
