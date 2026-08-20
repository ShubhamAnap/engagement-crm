/**
 * Multi-org identity for service-role code (RLS is bypassed).
 * Staff handlers: requireStaffOrgId().
 * Webhooks: resolveChannelByConfig().
 * Env credentials (WHATSAPP_*, etc.) apply only to DEFAULT_ORG_ID (legacy tenant).
 */
import { createServiceSupabase } from "@/lib/supabase";
import { orgIdMatchesLinkToken, readOrgLinkToken } from "@/lib/org-link-token";

export const DEFAULT_ORG_ID = "a0000000-0000-4000-8000-000000000001";

export type ServiceSupabase = ReturnType<typeof createServiceSupabase>;

export type ResolvedChannel = {
  orgId: string;
  channelId: string;
  config: Record<string, unknown>;
  isEnabled: boolean;
};

function asConfig(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export async function requireStaffOrgId(): Promise<string> {
  // Lazy-load to avoid pulling `@tanstack/react-start/server` into client bundles.
  const { requireStaffUser } = await import("@/server/staff-auth");
  const auth = await requireStaffUser();
  return auth.profile.org_id;
}

type OrgAsyncStore = import("node:async_hooks").AsyncLocalStorage<string>;
let orgStore: OrgAsyncStore | undefined;

async function getOrgStore(): Promise<OrgAsyncStore> {
  if (orgStore) return orgStore;

  // IMPORTANT:
  // Render's Vite build can incorrectly treat this module as "browser code" and replace
  // Node builtins with a stub that does NOT export AsyncLocalStorage.
  // Using a dynamic import avoids Rollup's named-export validation during browser bundling.
  const mod = await import("node:async_hooks");
  orgStore = new mod.AsyncLocalStorage<string>();
  return orgStore;
}

/** Org for the current webhook/cron/staff job (service-role code). */
export function tryJobOrgId(): string | undefined {
  return orgStore?.getStore();
}

export async function runWithOrg<T>(orgId: string, fn: () => T): Promise<T> {
  const store = await getOrgStore();
  return store.run(orgId, fn);
}

/**
 * Workspace for service-role work: cron/webhook ALS first, else the signed-in staff org.
 * Never falls back to DEFAULT_ORG_ID.
 */
export async function resolveServiceOrgId(): Promise<string> {
  const job = tryJobOrgId();
  if (job) return job;
  return requireStaffOrgId();
}

/** Env secrets (platform WhatsApp/Gmail/OpenAI defaults) only merge for the original tenant. */
export function allowEnvChannelFallback(orgId: string): boolean {
  return orgId === DEFAULT_ORG_ID;
}

/**
 * Workspaces that background work should touch. Suspended workspaces keep their data
 * but must not get cron ticks, outbound sends, or public link resolution.
 */
export async function listOrgIds(
  supabase: ServiceSupabase = createServiceSupabase(),
  options?: { includeSuspended?: boolean },
): Promise<string[]> {
  const withStatus = await supabase
    .from("organizations")
    .select("id, is_active, platform_suspended")
    .order("created_at", { ascending: true });

  if (withStatus.error) {
    // Pre-042 database — no suspension columns to filter on.
    const { data, error } = await supabase
      .from("organizations")
      .select("id")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => String(row.id)).filter(Boolean);
  }

  return (withStatus.data ?? [])
    .filter(
      (row) =>
        options?.includeSuspended ||
        (row.is_active !== false && row.platform_suspended !== true),
    )
    .map((row) => String(row.id))
    .filter(Boolean);
}

const ORG_STATUS_TTL_MS = 30_000;
const orgStatusCache = new Map<string, { live: boolean; at: number }>();

/**
 * True when the workspace is live (not self-disabled, not platform suspended).
 * Cached briefly because inbound webhooks call this on every event.
 */
export async function isOrgActive(
  supabase: ServiceSupabase,
  orgId: string,
): Promise<boolean> {
  const cached = orgStatusCache.get(orgId);
  if (cached && Date.now() - cached.at < ORG_STATUS_TTL_MS) return cached.live;

  const { data, error } = await supabase
    .from("organizations")
    .select("is_active, platform_suspended")
    .eq("id", orgId)
    .maybeSingle();

  // Pre-042 database — fail open rather than drop inbound messages.
  if (error) return true;

  const live = Boolean(data) && data!.is_active !== false && data!.platform_suspended !== true;
  orgStatusCache.set(orgId, { live, at: Date.now() });
  return live;
}

/** Public /c and /f links carry ?w={12 hex} — map it back to the sharing workspace. */
export async function resolveOrgIdFromLinkToken(
  supabase: ServiceSupabase,
  rawToken: string | null | undefined,
): Promise<string | null> {
  const token = readOrgLinkToken(rawToken);
  if (!token) return null;
  const ids = await listOrgIds(supabase);
  return ids.find((id) => orgIdMatchesLinkToken(id, token)) || null;
}

/** Match on a config value regardless of workspace status (uniqueness checks). */
async function findChannelByConfig(
  supabase: ServiceSupabase,
  filter: { type: string; configKey: string; configValue: string },
): Promise<ResolvedChannel | null> {
  const want = filter.configValue.trim();
  if (!want) return null;
  const { data: rows, error } = await supabase
    .from("channels")
    .select("id, org_id, config, is_enabled")
    .eq("type", filter.type);
  if (error) {
    console.error("findChannelByConfig", error.message);
    return null;
  }
  for (const row of rows ?? []) {
    const cfg = asConfig(row.config);
    if (String(cfg[filter.configKey] || "").trim() !== want) continue;
    return {
      orgId: String(row.org_id),
      channelId: String(row.id),
      config: cfg,
      isEnabled: row.is_enabled !== false,
    };
  }
  return null;
}

/** Route inbound traffic to its workspace. Suspended workspaces never match. */
export async function resolveChannelByConfig(
  supabase: ServiceSupabase,
  filter: { type: string; configKey: string; configValue: string },
): Promise<ResolvedChannel | null> {
  const hit = await findChannelByConfig(supabase, filter);
  if (!hit) return null;
  if (!(await isOrgActive(supabase, hit.orgId))) {
    console.warn(`inbound ${filter.type} ignored — workspace ${hit.orgId} is suspended`);
    return null;
  }
  return hit;
}

/** True if any channel of this type stores this verify_token (or env for the legacy org). */
export async function verifyTokenMatchesAnyOrg(
  supabase: ServiceSupabase,
  type: string,
  token: string,
  envToken?: string,
): Promise<boolean> {
  const want = token.trim();
  if (!want) return false;
  if (envToken && want === envToken.trim()) return true;
  const { data: rows } = await supabase.from("channels").select("config").eq("type", type);
  for (const row of rows ?? []) {
    const cfg = asConfig(row.config);
    if (String(cfg.verify_token || "").trim() === want) return true;
  }
  return false;
}

export function newWidgetPublicKey(): string {
  // Use WebCrypto when available (Node 20+ exposes `globalThis.crypto`).
  // This keeps server code bundling-safe (no static `node:crypto` import for Vite).
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(24);
    c.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `wgt_${hex}`;
  }

  // Extremely unlikely fallback (only if WebCrypto is missing).
  // Still produces a deterministic shape; collisions are practically impossible at 24 bytes.
  const hex = Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0"),
  ).join("");
  return `wgt_${hex}`;
}

export async function resolveWebsiteByWidgetKey(
  supabase: ServiceSupabase,
  key: string,
): Promise<ResolvedChannel | null> {
  const want = key.trim();
  if (!want) return null;
  const byConfig = await resolveChannelByConfig(supabase, {
    type: "website",
    configKey: "widget_public_key",
    configValue: want,
  });
  if (byConfig) return byConfig;

  const envKey = (process.env.WIDGET_PUBLIC_KEY || process.env.VITE_WIDGET_PUBLIC_KEY || "").trim();
  if (envKey && want === envKey) {
    const { data } = await supabase
      .from("channels")
      .select("id, org_id, config, is_enabled")
      .eq("org_id", DEFAULT_ORG_ID)
      .eq("type", "website")
      .maybeSingle();
    if (data && (await isOrgActive(supabase, DEFAULT_ORG_ID))) {
      return {
        orgId: DEFAULT_ORG_ID,
        channelId: String(data.id),
        config: asConfig(data.config),
        isEnabled: data.is_enabled !== false,
      };
    }
  }
  return null;
}

/**
 * Block two orgs from sharing an inbound identifier (WhatsApp phone, Meta page,
 * widget key, inbound email/IndiaMART secret). Webhooks route on these values, so a
 * duplicate would silently deliver one workspace's messages to the other.
 */
export async function assertUniqueChannelConfig(options: {
  supabase: ServiceSupabase;
  type: string;
  configKey: string;
  configValue: string;
  exceptOrgId: string;
  /** Customer-facing name for the field — never show the raw config key in the UI. */
  label?: string;
  /** Platform env value that already routes to the legacy tenant. */
  reservedEnvValue?: string;
}): Promise<void> {
  const want = options.configValue.trim();
  if (!want) return;

  const reserved = options.reservedEnvValue?.trim();
  if (reserved && want === reserved && options.exceptOrgId !== DEFAULT_ORG_ID) {
    throw new Error(
      `This ${options.label || options.configKey.replace(/_/g, " ")} is reserved. Choose a different value.`,
    );
  }

  // Deliberately not resolveChannelByConfig: a suspended workspace still owns its
  // identifiers, so a live workspace must not be allowed to claim them.
  const hit = await findChannelByConfig(options.supabase, {
    type: options.type,
    configKey: options.configKey,
    configValue: want,
  });
  if (hit && hit.orgId !== options.exceptOrgId) {
    const label = options.label || options.configKey.replace(/_/g, " ");
    throw new Error(`This ${label} is already connected to another workspace.`);
  }
}