import { createServiceSupabase } from "@/lib/supabase";
import type { DbAgent } from "@/lib/db-types";
import { parseAgentConfig } from "@/lib/agent-config";
import {
  AGENT_ENGAGEMENT_LOCK,
  AGENT_MASTER_ORCHESTRATION,
  defaultPromptForKey,
  effectiveSystemPrompt,
} from "@/lib/agent-prompts";
import { previewSpecialistKey, type ExtraRoutingMatcher } from "@/lib/agent-routing";
import { resolveLlmModel } from "@/server/llm-gateway";

import { resolveServiceOrgId, tryJobOrgId } from "@/server/org-context";

/** Default master orchestrator key (Support / EnerBot). */
export const MASTER_AGENT_KEY = "support";

function isMasterAgent(agent: DbAgent): boolean {
  return parseAgentConfig(agent.config).is_master || agent.key === MASTER_AGENT_KEY;
}

export async function loadAgentById(agentId: string): Promise<DbAgent | null> {
  const supabase = createServiceSupabase();
  const { data } = await supabase.from("agents").select("*").eq("id", agentId).maybeSingle();
  return (data as DbAgent) || null;
}

export async function loadAgentByKey(key: string, orgId?: string): Promise<DbAgent | null> {
  const id = orgId || (await resolveServiceOrgId());
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("agents")
    .select("*")
    .eq("org_id", id)
    .eq("key", key)
    .maybeSingle();
  return (data as DbAgent) || null;
}

export async function loadMasterAgent(orgId?: string): Promise<DbAgent | null> {
  const id = orgId || (await resolveServiceOrgId());
  const supabase = createServiceSupabase();
  const { data: flagged } = await supabase
    .from("agents")
    .select("*")
    .eq("org_id", id)
    .eq("status", "Active")
    .contains("config", { is_master: true })
    .limit(1)
    .maybeSingle();
  if (flagged) return flagged as DbAgent;

  const support = await loadAgentByKey(MASTER_AGENT_KEY, id);
  if (support && support.status === "Active") return support;

  const { data: anyActive } = await supabase
    .from("agents")
    .select("*")
    .eq("org_id", id)
    .eq("status", "Active")
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (anyActive as DbAgent) || support;
}

async function loadExtraRoutingMatchers(orgId: string): Promise<ExtraRoutingMatcher[]> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("agents")
    .select("key, status, config")
    .eq("org_id", orgId)
    .eq("status", "Active");
  const out: ExtraRoutingMatcher[] = [];
  for (const row of data || []) {
    const key = String(row.key || "");
    if (!key || key === MASTER_AGENT_KEY) continue;
    const kws = parseAgentConfig(row.config as Record<string, unknown>).routing_keywords;
    if (kws.length) out.push({ key, keywords: kws });
  }
  return out;
}

export type AgentStack = {
  master: DbAgent | null;
  specialist: DbAgent | null;
};

/**
 * Master owns the thread; a specialist is chosen per message when needed.
 * Conversation agent_id should stay on the master.
 */
export async function resolveAgentStack(options: {
  orgId?: string;
  channel?: string | null;
  message?: string;
  previousSpecialistKey?: string | null;
}): Promise<AgentStack> {
  const orgId = options.orgId || tryJobOrgId() || (await resolveServiceOrgId());
  const master = await loadMasterAgent(orgId);
  const extraMatchers = await loadExtraRoutingMatchers(orgId);

  const specialistKey = previewSpecialistKey(options.channel, options.message, {
    previousKey: options.previousSpecialistKey,
    extraMatchers,
  });
  if (!specialistKey) {
    return { master, specialist: null };
  }

  // Don't "specialize" into the master itself
  if (master && specialistKey === master.key) {
    return { master, specialist: null };
  }

  const specialist = await loadAgentByKey(specialistKey, orgId);
  if (!specialist || specialist.status !== "Active" || isMasterAgent(specialist)) {
    return { master, specialist: null };
  }

  return { master, specialist };
}

/** @deprecated Prefer resolveAgentStack — kept for any older call sites */
export async function resolveChatAgent(options: {
  orgId?: string;
  channel?: string | null;
  message?: string;
  agentId?: string | null;
}): Promise<DbAgent | null> {
  const stack = await resolveAgentStack(options);
  return stack.specialist || stack.master;
}

function allowedToolsFromConfig(config: Record<string, unknown> | null | undefined): string[] {
  return parseAgentConfig(config).allowed_tools;
}

/** Union of tools allowed on master and specialist (still must be globally enabled). */
export function agentAllowedToolKeys(stack: AgentStack | DbAgent | null): string[] {
  const normalized: AgentStack =
    stack && "master" in (stack as AgentStack)
      ? (stack as AgentStack)
      : { master: (stack as DbAgent | null) || null, specialist: null };
  const keys = new Set<string>();
  for (const agent of [normalized.master, normalized.specialist]) {
    if (!agent) continue;
    for (const k of allowedToolsFromConfig(agent.config)) keys.add(k);
  }
  return [...keys];
}

export function agentReplyConfig(stack: AgentStack | DbAgent | null) {
  const normalized: AgentStack =
    stack && "master" in (stack as AgentStack)
      ? (stack as AgentStack)
      : { master: (stack as DbAgent | null) || null, specialist: null };

  const { master, specialist } = normalized;
  const allowedTools = agentAllowedToolKeys(normalized);

  if (!master && !specialist) {
    return {
      agentId: null as string | null,
      specialistId: null as string | null,
      agentName: "EnerBot",
      model: resolveLlmModel("agents.reply"),
      systemPrompt: `${AGENT_MASTER_ORCHESTRATION}\n\n${defaultPromptForKey("support")}\n\n${AGENT_ENGAGEMENT_LOCK}`,
      memoryEnabled: true,
      assigneeLabel: "AI · Master Agent",
      specialistKey: null as string | null,
      allowedTools: [] as string[],
      knowledgeCollectionIds: [] as string[],
      productCategories: [] as string[],
    };
  }

  const owner = master || specialist!;
  const model = resolveLlmModel("agents.reply", specialist?.model || master?.model);
  const memoryEnabled = master?.memory_enabled ?? specialist?.memory_enabled ?? true;

  const parts: string[] = [AGENT_MASTER_ORCHESTRATION];

  if (master) {
    parts.push(`Master role instructions:\n${effectiveSystemPrompt(master)}`);
  }

  if (specialist) {
    parts.push(
      `Specialist brief for this reply (${specialist.name} / ${specialist.key}):\n${effectiveSystemPrompt(specialist)}\nApply this specialist focus for the current user question while staying consistent with the conversation so far.`,
    );
  }

  parts.push(AGENT_ENGAGEMENT_LOCK);

  const assigneeLabel = specialist
    ? `AI · ${owner.name} → ${specialist.name}`
    : `AI · ${owner.name}`;

  const specCfg = parseAgentConfig(specialist?.config);
  const masterCfg = parseAgentConfig(master?.config);
  const knowledgeCollectionIds = specCfg.knowledge_collection_ids.length
    ? specCfg.knowledge_collection_ids
    : masterCfg.knowledge_collection_ids;
  const productCategories = specCfg.product_categories.length
    ? specCfg.product_categories
    : masterCfg.product_categories;

  return {
    agentId: owner.id,
    specialistId: specialist?.id || null,
    agentName: specialist ? `${owner.name} (+ ${specialist.name})` : owner.name,
    model,
    systemPrompt: parts.join("\n\n"),
    memoryEnabled,
    assigneeLabel,
    specialistKey: specialist?.key || null,
    allowedTools,
    knowledgeCollectionIds,
    productCategories,
  };
}
