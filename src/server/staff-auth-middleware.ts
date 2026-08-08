import { createMiddleware } from "@tanstack/react-start";
import { PUBLIC_SERVER_FN_NAMES } from "@/server/staff-auth-public";

/**
 * Global function middleware: attach Bearer on client; require staff on server
 * except PUBLIC_SERVER_FN_NAMES (widget).
 */
export const staffAuthMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    let headers: HeadersInit = {};
    if (typeof window !== "undefined") {
      try {
        const { getBrowserSupabase } = await import("@/lib/supabase");
        const { data } = await getBrowserSupabase().auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          headers = { Authorization: `Bearer ${token}` };
        }
      } catch {
        // ignore — server will 401 privileged fns
      }
    }
    return next({ headers });
  })
  .server(async ({ next, serverFnMeta }) => {
    if (!PUBLIC_SERVER_FN_NAMES.has(serverFnMeta.name)) {
      const { requireStaffUser } = await import("@/server/staff-auth");
      await requireStaffUser();
    }
    return next();
  });
