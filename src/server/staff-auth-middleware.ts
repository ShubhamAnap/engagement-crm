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
  .server(async ({ next, serverFnMeta }) => {
    if (PUBLIC_SERVER_FN_NAMES.has(serverFnMeta.name)) {
      return next();
    }

    // Dynamic import: this module also runs on the client, where TanStack Start's
    // import protection denies `@tanstack/react-start/server`.
    const { getRequestHeader } = await import("@tanstack/react-start/server");

    const authHeader = getRequestHeader("authorization");
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    let token = bearer || null;
    if (!token) {
      const cookieHeader = getRequestHeader("cookie") || "";
      const match = cookieHeader.match(
        new RegExp(`(?:^|;\\s*)${STAFF_ACCESS_COOKIE}=([^;]*)`),
      );
      const raw = match?.[1]?.trim();
      if (raw) {
        try {
          token = decodeURIComponent(raw);
        } catch {
          token = raw;
        }
      }
    }

    const { requireStaffUser, runWithStaffToken } = await import("@/server/staff-auth");
    return runWithStaffToken(token, async () => {
      await requireStaffUser();
      return next();
    });
  });
