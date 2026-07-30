import { getBrowserSupabase } from "@/lib/supabase";
import type { AgentStatus, DbAgent } from "@/lib/db-types";
import { ENERTECH_ORG_ID } from "@/lib/chat-api";

export type AgentUpdateInput = {
  name: string;
  description?: string;
  status: AgentStatus;
  model: string;
  memoryEnabled: boolean;
  systemPrompt?: string;
};

export {
  AGENT_MODEL_OPTIONS,
  DEFAULT_AGENT_PROMPTS,
  defaultPromptForKey,
  effectiveSystemPrompt,
} from "@/lib/agent-prompts";

export async function listAgents(orgId: string = ENERTECH_ORG_ID): Promise<DbAgent[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("org_id", orgId)
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as DbAgent[];
}

export async function listAgentsWithStats(orgId: string = ENERTECH_ORG_ID): Promise<
  Array<DbAgent & { conversationCount: number; aiMessageCount: number }>
> {
  const agents = await listAgents(orgId);
  if (agents.length === 0) return [];

  const supabase = getBrowserSupabase();
  const ids = agents.map((a) => a.id);

  const { data: convos } = await supabase
    .from("conversations")
    .select("id, agent_id")
    .eq("org_id", orgId)
    .in("agent_id", ids);

  const convoIdsByAgent = new Map<string, string[]>();
  for (const c of convos ?? []) {
    if (!c.agent_id) continue;
    const list = convoIdsByAgent.get(c.agent_id) || [];
    list.push(c.id);
    convoIdsByAgent.set(c.agent_id, list);
  }

  const allConvoIds = (convos ?? []).map((c) => c.id);
  let aiByConvo = new Map<string, number>();
  if (allConvoIds.length > 0) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("conversation_id")
      .eq("org_id", orgId)
      .eq("sender", "ai")
      .in("conversation_id", allConvoIds.slice(0, 500));
    aiByConvo = new Map();
    for (const m of msgs ?? []) {
      const id = m.conversation_id as string;
      aiByConvo.set(id, (aiByConvo.get(id) || 0) + 1);
    }
  }

  return agents.map((a) => {
    const convoIds = convoIdsByAgent.get(a.id) || [];
    const aiMessageCount = convoIds.reduce((sum, id) => sum + (aiByConvo.get(id) || 0), 0);
    return {
      ...a,
      conversationCount: convoIds.length,
      aiMessageCount,
    };
  });
}

export async function updateAgent(agentId: string, input: AgentUpdateInput): Promise<DbAgent> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("agents")
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: input.status,
      model: input.model.trim() || "gpt-4o-mini",
      memory_enabled: input.memoryEnabled,
      system_prompt: input.systemPrompt?.trim() || null,
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
