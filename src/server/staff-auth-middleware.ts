import { createMiddleware } from "@tanstack/react-start";
import { PUBLIC_SERVER_FN_NAMES, STAFF_ACCESS_COOKIE } from "@/server/staff-auth-public";

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
  .server(async ({ next, request, serverFnMeta }) => {
    function extractStaffToken(): string | null {
      const authHeader = request.headers.get("authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const bearer = authHeader.slice(7).trim();
        if (bearer) return bearer;
      }

      const cookieHeader = request.headers.get("cookie") || "";
      const re = new RegExp(`(?:^|;\\s*)${STAFF_ACCESS_COOKIE}=([^;]*)`);
      const match = cookieHeader.match(re);
      const raw = match?.[1]?.trim();
      if (!raw) return null;

      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }

    if (!PUBLIC_SERVER_FN_NAMES.has(serverFnMeta.name)) {
      const { requireStaffUser, runWithStaffToken } = await import("@/server/staff-auth");
      const token = extractStaffToken();
      return runWithStaffToken(token, async () => {
        await requireStaffUser();
        return next();
      });
    }
    return next();
  });
