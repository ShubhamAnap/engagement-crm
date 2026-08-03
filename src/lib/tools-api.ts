import { getBrowserSupabase } from "@/lib/supabase";
import { ENERTECH_ORG_ID } from "@/lib/chat-api";

export type DbAiTool = {
  id: string;
  org_id: string;
  key: string;
  name: string;
  description: string | null;
  is_enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export function allowedToolsFromAgentConfig(
  config: Record<string, unknown> | null | undefined,
): string[] {
  const raw = config?.allowed_tools;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((t) => String(t).trim()).filter(Boolean))];
}

export async function listAiTools(orgId: string = ENERTECH_ORG_ID): Promise<DbAiTool[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("ai_tools")
    .select("*")
    .eq("org_id", orgId)
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as DbAiTool[];
}

export async function setAiToolEnabled(options: {
  toolId: string;
  enabled: boolean;
}): Promise<DbAiTool> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("ai_tools")
    .update({ is_enabled: options.enabled })
    .eq("id", options.toolId)
    .select("*")
    .single();

  if (error) throw error;
  return data as DbAiTool;
}

/** Seed Calculator + Web search if table is empty (migration may not have run). */
export async function ensureDefaultAiTools(orgId: string = ENERTECH_ORG_ID): Promise<DbAiTool[]> {
  const existing = await listAiTools(orgId).catch(() => [] as DbAiTool[]);
  if (existing.length > 0) return existing;

  const supabase = getBrowserSupabase();
  const defaults = [
    {
      org_id: orgId,
      key: "calculator",
      name: "Calculator",
      description:
        "Accurate math and UPS/battery runtime estimates (kVA, load %, Ah, minutes). Prefer this over guessing numbers.",
      is_enabled: true,
    },
    {
      org_id: orgId,
      key: "web_search",
      name: "Web search",
      description:
        "Optional public web lookup. Prefer Knowledge Base for EnerTech specs; use only for general public facts.",
      is_enabled: false,
    },
  ];

  const { error } = await supabase.from("ai_tools").upsert(defaults, {
    onConflict: "org_id,key",
    ignoreDuplicates: true,
  });
  if (error) throw error;
  return listAiTools(orgId);
}
