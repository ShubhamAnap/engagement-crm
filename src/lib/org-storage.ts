/**
 * Client-safe storage path rules for multi-org isolation.
 * Object names must be `{orgId}/…` so Storage RLS can scope list/write.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function orgStoragePrefix(orgId: string): string {
  const id = orgId.trim();
  if (!UUID_RE.test(id)) throw new Error("Invalid organization id");
  return `${id}/`;
}

/** `{orgId}/chat/…`, `{orgId}/products/…`, etc. */
export function orgStoragePath(orgId: string, ...segments: string[]): string {
  const prefix = orgStoragePrefix(orgId);
  const rest = segments
    .map((s) => String(s || "").replace(/^\/+|\/+$/g, "").replace(/\.\./g, ""))
    .filter(Boolean)
    .join("/");
  if (!rest) throw new Error("Storage path is missing");
  return `${prefix}${rest}`;
}

export function assertOrgStoragePath(path: string, orgId: string): string {
  const cleaned = String(path || "").replace(/^\/+/, "");
  const prefix = orgStoragePrefix(orgId);
  if (!cleaned.startsWith(prefix)) {
    throw new Error("File path does not belong to this workspace");
  }
  return cleaned;
}
