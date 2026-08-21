/**
 * Platform-wide settings (maintenance banner). Separate from platform-console so
 * the public read path does not pull the whole admin surface into the login shell.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { recordAuditEvent } from "@/server/audit-log";
import { requirePlatformAdmin } from "@/server/platform-auth";

export type MaintenanceSeverity = "info" | "warning" | "critical";

export type PlatformSettings = {
  maintenanceEnabled: boolean;
  maintenanceMessage: string;
  maintenanceSeverity: MaintenanceSeverity;
  updatedAt: string | null;
};

const DEFAULT_SETTINGS: PlatformSettings = {
  maintenanceEnabled: false,
  maintenanceMessage: "",
  maintenanceSeverity: "info",
  updatedAt: null,
};

function mapRow(row: Record<string, unknown> | null | undefined): PlatformSettings {
  if (!row) return { ...DEFAULT_SETTINGS };
  const severity = String(row.maintenance_severity || "info");
  return {
    maintenanceEnabled: row.maintenance_enabled === true,
    maintenanceMessage: typeof row.maintenance_message === "string" ? row.maintenance_message : "",
    maintenanceSeverity:
      severity === "warning" || severity === "critical" ? severity : "info",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

async function loadSettingsRow() {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("platform_settings")
    .select("maintenance_enabled, maintenance_message, maintenance_severity, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    throw new Error(error.message);
  }
  return data as Record<string, unknown> | null;
}

/** Public — login, status, and tenant shells. Returns disabled when migration 046 is missing. */
export const getPublicMaintenanceBanner = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const row = await loadSettingsRow();
    const settings = mapRow(row);
    return {
      enabled: settings.maintenanceEnabled,
      message: settings.maintenanceMessage,
      severity: settings.maintenanceSeverity,
    };
  } catch {
    return { enabled: false, message: "", severity: "info" as const };
  }
});

export const getPlatformSettings = createServerFn({ method: "GET" }).handler(async () => {
  await requirePlatformAdmin();
  const row = await loadSettingsRow();
  if (!row) {
    return {
      ...DEFAULT_SETTINGS,
      missingMigration: true as const,
    };
  }
  return { ...mapRow(row), missingMigration: false as const };
});

export const setPlatformMaintenance = createServerFn({ method: "POST" })
  .validator(
    z.object({
      enabled: z.boolean(),
      message: z.string().max(500),
      severity: z.enum(["info", "warning", "critical"]),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin();
    const supabase = createServiceSupabase();
    const message = data.enabled ? data.message.trim() : data.message.trim();
    if (data.enabled && !message) {
      throw new Error("Add a short message before turning maintenance on.");
    }

    const { error } = await supabase.from("platform_settings").upsert({
      id: 1,
      maintenance_enabled: data.enabled,
      maintenance_message: message,
      maintenance_severity: data.severity,
      updated_at: new Date().toISOString(),
      updated_by: auth.profile.id,
    });
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        throw new Error(
          "Maintenance banner needs migration 046_platform_settings.sql applied to this database.",
        );
      }
      throw new Error(error.message);
    }

    void recordAuditEvent({
      orgId: null,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      action: "platform.maintenance",
      resourceType: "platform_settings",
      resourceId: "1",
      metadata: {
        enabled: data.enabled,
        severity: data.severity,
        messageLength: message.length,
      },
    });

    return { ok: true as const };
  });
