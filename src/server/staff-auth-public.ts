/** Cookie mirror of access token (SameSite=Lax). Keep in sync with `src/lib/staff-access-cookie.ts`. */
export const STAFF_ACCESS_COOKIE = "enertech_sb_access";

/**
 * Public server functions (website widget). Everything else requires a signed-in staff profile.
 * Cron / Meta / inbound webhooks use API routes, not createServerFn.
 */
export const PUBLIC_SERVER_FN_NAMES = new Set([
  "widgetGetOrCreateConversation",
  "widgetLookupVisitor",
  "widgetListMessages",
  "widgetSendMessage",
  "widgetSelectProduct",
  "widgetUploadAttachment",
]);
