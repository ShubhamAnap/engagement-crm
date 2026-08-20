/**
 * Short workspace token carried by public links (/c/{sku}, /f/{file}).
 * Without it, two workspaces sharing a SKU — or two documents whose UUIDs share
 * the same 8-hex prefix — would resolve to whichever row the DB returned first.
 */

const TOKEN_LENGTH = 12;

/** First 12 hex chars of the org UUID. Empty when the id is unusable. */
export function orgLinkToken(orgId: string | null | undefined): string {
  const hex = String(orgId || "")
    .replace(/[^0-9a-fA-F]/g, "")
    .toLowerCase();
  return hex.length >= TOKEN_LENGTH ? hex.slice(0, TOKEN_LENGTH) : "";
}

export function orgLinkTokenParam(orgId: string | null | undefined): string {
  const token = orgLinkToken(orgId);
  return token ? `?w=${token}` : "";
}

/** Normalize a token read from a request query string. */
export function readOrgLinkToken(raw: string | null | undefined): string {
  const token = String(raw || "")
    .replace(/[^0-9a-fA-F]/g, "")
    .toLowerCase();
  return token.length === TOKEN_LENGTH ? token : "";
}

export function orgIdMatchesLinkToken(orgId: string | null | undefined, token: string): boolean {
  if (!token) return false;
  return orgLinkToken(orgId) === token;
}
