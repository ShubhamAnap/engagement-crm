import { getBrowserSupabase } from "@/lib/supabase";
import type { AgentStatus, DbAgent } from "@/lib/db-types";
import { mergeAgentConfig, parseAgentConfig } from "@/lib/agent-config";

export type AgentUpdateInput = {
  name: string;
  description?: string;
  status: AgentStatus;
  model: string;
  memoryEnabled: boolean;
  systemPrompt?: string;
  /** Tool keys this agent may use (must also be enabled on /tools). */
  allowedTools?: string[];
  knowledgeCollectionIds?: string[];
  productCategories?: string[];
  routingKeywords?: string[];
};

export type AgentCreateInput = {
  key: string;
  name: string;
  description?: string;
  routingKeywords?: string[];
};

export {
  AGENT_MODEL_OPTIONS,
  AGENT_ORG_DEFAULT_MODEL,
  AGENT_ENGAGEMENT_LOCK,
  AGENT_MASTER_ORCHESTRATION,
  DEFAULT_AGENT_PROMPTS,
  defaultPromptForKey,
  displayAgentModel,
  effectiveSystemPrompt,
} from "@/lib/agent-prompts";

export async function listAgents(orgId: string): Promise<DbAgent[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("org_id", orgId)
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as DbAgent[];
}

async function countAiOnConversations(
  supabase: ReturnType<typeof getBrowserSupabase>,
  orgId: string,
  convoIds: string[],
): Promise<number> {
  if (convoIds.length === 0) return 0;
  let total = 0;
  const page = 100;
  for (let i = 0; i < convoIds.length; i += page) {
    const slice = convoIds.slice(i, i + page);
    const { count, error } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("sender", "ai")
      .in("conversation_id", slice);
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}

export async function listAgentsWithStats(orgId: string): Promise<
  Array<DbAgent & { conversationCount: number; aiMessageCount: number; lastRoutedCount: number }>
> {
  const agents = await listAgents(orgId);
  if (agents.length === 0) return [];

  const supabase = getBrowserSupabase();
  const ids = new Set(agents.map((a) => a.id));

  const { data: convos, error: convoErr } = await supabase
    .from("conversations")
    .select("id, agent_id, metadata")
    .eq("org_id", orgId)
    .limit(5000);
  if (convoErr) throw convoErr;

  const convoIdsByAgent = new Map<string, string[]>();
  const routedIdsByKey = new Map<string, string[]>();
  for (const c of convos ?? []) {
    if (c.agent_id && ids.has(c.agent_id)) {
      const list = convoIdsByAgent.get(c.agent_id) || [];
      list.push(c.id);
      convoIdsByAgent.set(c.agent_id, list);
    }
    const meta =
      c.metadata && typeof c.metadata === "object" && !Array.isArray(c.metadata)
        ? (c.metadata as Record<string, unknown>)
        : null;
    const specialistKey =
      typeof meta?.specialist_key === "string" ? meta.specialist_key.trim() : "";
    if (specialistKey) {
      const list = routedIdsByKey.get(specialistKey) || [];
      list.push(c.id);
      routedIdsByKey.set(specialistKey, list);
    }
  }

  const results: Array<DbAgent & { conversationCount: number; aiMessageCount: number; lastRoutedCount: number }> = [];
  for (const a of agents) {
    const isMaster = a.key === "support" || parseAgentConfig(a.config).is_master;
    const ownedIds = convoIdsByAgent.get(a.id) || [];
    const routedIds = isMaster ? [] : routedIdsByKey.get(a.key) || [];
    const countIds = isMaster ? ownedIds : routedIds;
    const aiMessageCount = await countAiOnConversations(supabase, orgId, countIds);
    results.push({
      ...a,
      conversationCount: isMaster ? ownedIds.length : routedIds.length,
      lastRoutedCount: routedIds.length,
      aiMessageCount,
    });
  }
  return results;
}

export function slugAgentKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function createAgent(orgId: string, input: AgentCreateInput): Promise<DbAgent> {
  const supabase = getBrowserSupabase();
  const key = slugAgentKey(input.key || input.name);
  if (!key) throw new Error("Key is required (letters and numbers)");
  const { data, error } = await supabase
    .from("agents")
    .insert({
      org_id: orgId,
      key,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: "Active",
      model: "org-default",
      memory_enabled: true,
      system_prompt: null,
      config: {
        allowed_tools: [],
        routing_keywords: (input.routingKeywords || []).map((k) => k.trim()).filter(Boolean),
        knowledge_collection_ids: [],
        product_categories: [],
      },
    })
    .select("*")
    .single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error(`Agent key “${key}” already exists`);
    throw error;
  }
  return data as DbAgent;
}

export async function updateAgent(agentId: string, input: AgentUpdateInput): Promise<DbAgent> {
  const supabase = getBrowserSupabase();

  const { data: current, error: curErr } = await supabase
    .from("agents")
    .select("config")
    .eq("id", agentId)
    .maybeSingle();
  if (curErr) throw curErr;

  const prevConfig =
    current?.config && typeof current.config === "object" && !Array.isArray(current.config)
      ? ({ ...(current.config as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const next = mergeAgentConfig(prevConfig, {
    allowed_tools: input.allowedTools,
    knowledge_collection_ids: input.knowledgeCollectionIds,
    product_categories: input.productCategories,
    routing_keywords: input.routingKeywords,
  });

  const { data, error } = await supabase
    .from("agents")
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: input.status,
      model: input.model.trim() || "org-default",
      memory_enabled: input.memoryEnabled,
      system_prompt: input.systemPrompt?.trim() || null,
      config: next,
    })
    .eq("id", agentId)
    .select("*")
    .single();

  if (error) throw error;
  return data as DbAgent;
}

export async function setAgentStatus(agentId: string, status: AgentStatus): Promise<DbAgent> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("agents")
    .update({ status })
    .eq("id", agentId)
    .select("*")
    .single();

  if (error) throw error;
  return data as DbAgent;
}
