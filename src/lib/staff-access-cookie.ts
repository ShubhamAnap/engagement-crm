/** Keep in sync with `STAFF_ACCESS_COOKIE` in `src/server/staff-auth.ts`. */
export const STAFF_ACCESS_COOKIE = "enertech_sb_access";

/** Mirror Supabase access token into a cookie so server functions can auth during SSR. */
export function syncStaffAccessCookie(accessToken: string | null | undefined) {
  if (typeof document === "undefined") return;

  if (accessToken) {
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
    // Align roughly with typical Supabase session length; refresh keeps rewriting.
    document.cookie = `${STAFF_ACCESS_COOKIE}=${encodeURIComponent(accessToken)}; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}${secure}`;
  } else {
    document.cookie = `${STAFF_ACCESS_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}
