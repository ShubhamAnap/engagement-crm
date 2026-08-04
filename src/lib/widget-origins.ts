/**
 * Website chat widget origin allowlist.
 * Empty allowlist → block (except always-allowed preview hosts).
 * Subdomains of an allowed apex domain are allowed automatically.
 */

export const ALWAYS_ALLOWED_WIDGET_HOSTS = [
  "enertechups-ai.onrender.com",
  "localhost",
  "127.0.0.1",
] as const;

/** Normalize user/URL input to a bare hostname (lowercase, no www). */
export function normalizeWidgetHost(input: string | null | undefined): string | null {
  if (!input?.trim()) return null;
  let raw = input.trim().toLowerCase();
  try {
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const url = new URL(raw);
    let host = url.hostname;
    if (host.startsWith("www.")) host = host.slice(4);
    return host || null;
  } catch {
    let host = raw.split("/")[0]?.split("?")[0]?.split("#")[0] || "";
    host = host.split(":")[0] || "";
    if (host.startsWith("www.")) host = host.slice(4);
    return host || null;
  }
}

export function parseAllowedOriginsText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/[\n,;]+/)) {
    const host = normalizeWidgetHost(line);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

export function formatAllowedOriginsText(origins: string[] | null | undefined): string {
  return (origins ?? []).join("\n");
}

export function hostMatchesAllowed(requestHost: string, allowedHost: string): boolean {
  const host = normalizeWidgetHost(requestHost);
  const allowed = normalizeWidgetHost(allowedHost);
  if (!host || !allowed) return false;
  if (host === allowed) return true;
  return host.endsWith(`.${allowed}`);
}

export function isWidgetOriginAllowed(options: {
  pageOrigin: string | null | undefined;
  allowedOrigins: string[];
  extraAlwaysAllowedHosts?: string[];
}): boolean {
  const host = normalizeWidgetHost(options.pageOrigin);
  if (!host) return false;

  const always = new Set<string>([
    ...ALWAYS_ALLOWED_WIDGET_HOSTS.map((h) => h.toLowerCase()),
    ...(options.extraAlwaysAllowedHosts ?? []).map((h) => h.toLowerCase()),
  ]);
  for (const entry of always) {
    if (hostMatchesAllowed(host, entry)) return true;
  }

  if (options.allowedOrigins.length === 0) return false;

  return options.allowedOrigins.some((entry) => hostMatchesAllowed(host, entry));
}
