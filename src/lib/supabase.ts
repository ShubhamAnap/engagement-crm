import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

/** Browser / client Supabase (anon key). Session stored in localStorage. */
export function createBrowserSupabase(): SupabaseClient {
  const url = requireEnv(import.meta.env.VITE_SUPABASE_URL, "VITE_SUPABASE_URL");
  const anon = requireEnv(import.meta.env.VITE_SUPABASE_ANON_KEY, "VITE_SUPABASE_ANON_KEY");
  return createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

let browserClient: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("getBrowserSupabase() is client-only");
  }
  if (!browserClient) browserClient = createBrowserSupabase();
  return browserClient;
}

/** Server Supabase with service role — never import this into client components. */
export function createServiceSupabase(): SupabaseClient {
  const url = requireEnv(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    "SUPABASE_URL",
  );
  const key = requireEnv(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
