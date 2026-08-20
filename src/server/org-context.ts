/**
 * Multi-org identity for service-role code (RLS is bypassed).
 * Staff handlers: requireStaffOrgId().
 * Webhooks: resolveChannelByConfig().
 * Env credentials (WHATSAPP_*, etc.) apply only to DEFAULT_ORG_ID (legacy tenant).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase";
import { requireStaffUser } from "@/server/staff-auth";

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
  const auth = await requireStaffUser();
  return auth.profile.org_id;
}

const orgStore = new AsyncLocalStorage<string>();

/** Org for the current webhook/cron/staff job (service-role code). */
export function tryJobOrgId(): string | undefined {
  return orgStore.getStore();
}

export function runWithOrg<T>(orgId: string, fn: () => T): T {
  return orgStore.run(orgId, fn);
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

export async function listOrgIds(
  supabase: ServiceSupabase = createServiceSupabase(),
): Promise<string[]> {
  const { data, error } = await supabase.from("organizations").select("id").order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => String(row.id)).filter(Boolean);
}

export async function resolveChannelByConfig(
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
    console.error("resolveChannelByConfig", error.message);
    return null;
  }
  for (const row of rows ?? []) {
    const cfg = asConfig(row.config);
    if (String(cfg[filter.configKey] || "").trim() === want) {
      return {
        orgId: String(row.org_id),
        channelId: String(row.id),
        config: cfg,
        isEnabled: row.is_enabled !== false,
      };
    }
  }
  return null;
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
  return `wgt_${randomBytes(24).toString("hex")}`;
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
    if (data) {
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

/** Block two orgs from sharing the same WhatsApp phone / Meta page / widget key. */
export async function assertUniqueChannelConfig(options: {
  supabase: ServiceSupabase;
  type: string;
  configKey: string;
  configValue: string;
  exceptOrgId: string;
}): Promise<void> {
  const want = options.configValue.trim();
  if (!want) return;
  const hit = await resolveChannelByConfig(options.supabase, {
    type: options.type,
    configKey: options.configKey,
    configValue: want,
  });
  if (hit && hit.orgId !== options.exceptOrgId) {
    throw new Error(`This ${options.configKey} is already used by another workspace.`);
  }
}

/** @deprecated Prefer resolveChannelByConfig — silent DEFAULT fallback hid missing orgs. */
export async function resolveOrgFromChannel(
  supabase: ServiceSupabase,
  filter: { type: string; configKey?: string; configValue?: string },
): Promise<string> {
  if (filter.configKey && filter.configValue) {
    const hit = await resolveChannelByConfig(supabase, {
      type: filter.type,
      configKey: filter.configKey,
      configValue: filter.configValue,
    });
    if (hit) return hit.orgId;
  }
  return DEFAULT_ORG_ID;
}
