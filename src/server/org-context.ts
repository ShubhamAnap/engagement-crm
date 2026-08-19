/**
 * Default org for backward compatibility during multi-org migration.
 * Server functions should accept orgId as a parameter; this is the fallback.
 */
export const DEFAULT_ORG_ID = "a0000000-0000-4000-8000-000000000001";

/**
 * Resolve orgId from a channel row's phone_number_id, type, or webhook identifier.
 * Used by inbound webhook handlers to route to the correct org.
 */
export async function resolveOrgFromChannel(
  supabase: ReturnType<typeof import("@/lib/supabase").createServiceSupabase>,
  filter: { type: string; configKey?: string; configValue?: string },
): Promise<string> {
  if (filter.configKey && filter.configValue) {
    const { data: rows } = await supabase
      .from("channels")
      .select("org_id, config")
      .eq("type", filter.type)
      .eq("is_enabled", true);
    for (const row of rows ?? []) {
      const cfg = (row.config && typeof row.config === "object" ? row.config : {}) as Record<string, unknown>;
      if (String(cfg[filter.configKey] || "").trim() === filter.configValue.trim()) {
        return row.org_id as string;
      }
    }
  }
  return DEFAULT_ORG_ID;
}
