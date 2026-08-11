import { getBrowserSupabase } from "@/lib/supabase";
import { ENERTECH_ORG_ID } from "@/lib/chat-api";
import { listAgents } from "@/lib/agents-api";

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

/** Ops note: which agents still list this tool in config (even if globally off). */
export async function listAgentsUsingTool(
  toolKey: string,
  orgId: string = ENERTECH_ORG_ID,
): Promise<Array<{ id: string; name: string; key: string }>> {
  const agents = await listAgents(orgId);
  return agents
    .filter((a) => allowedToolsFromAgentConfig(a.config).includes(toolKey))
    .map((a) => ({ id: a.id, name: a.name, key: a.key }));
}

/** Remove a tool key from every agent's allowed_tools (after global disable). */
export async function stripToolFromAllAgents(
  toolKey: string,
  orgId: string = ENERTECH_ORG_ID,
): Promise<number> {
  const agents = await listAgents(orgId);
  const supabase = getBrowserSupabase();
  let updated = 0;
  for (const agent of agents) {
    const allowed = allowedToolsFromAgentConfig(agent.config);
    if (!allowed.includes(toolKey)) continue;
    const next = allowed.filter((k) => k !== toolKey);
    const { error } = await supabase
      .from("agents")
      .update({
        config: {
          ...(agent.config && typeof agent.config === "object" ? agent.config : {}),
          allowed_tools: next,
        },
      })
      .eq("id", agent.id)
      .eq("org_id", orgId);
    if (error) throw error;
    updated += 1;
  }
  return updated;
}

export function toolRuntimeHint(toolKey: string): {
  ready: boolean;
  detail: string;
} {
  if (toolKey === "calculator") {
    return { ready: true, detail: "Runs on server — no extra API key" };
  }
  if (toolKey === "web_search") {
    return {
      ready: false,
      detail: "Needs TAVILY_API_KEY or WEB_SEARCH_API_KEY on the server (.env / Render)",
    };
  }
  return { ready: true, detail: "Server-side runner" };
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
