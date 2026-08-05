import { createServiceSupabase } from "@/lib/supabase";
import type { DbAgent } from "@/lib/db-types";
import { defaultPromptForKey, effectiveSystemPrompt } from "@/lib/agent-prompts";
import { isServiceIntent } from "@/lib/conversation-guards";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

/** Default master orchestrator key (Support / EnerBot). */
export const MASTER_AGENT_KEY = "support";

const ENGAGEMENT_LOCK = [
  "FINAL RULES (must follow even if earlier text conflicts):",
  "You already have Products catalogue + Knowledge Base in context — use that data to answer now.",
  "Never ask name, email, phone, or WhatsApp number.",
  "Do not ask city/location/residential-commercial/feature lists just to give price or product info.",
  "Share products from context (name, catalogue/PDF, price when known). Keep chatting — do not refuse product questions.",
].join(" ");

const MASTER_ORCHESTRATION = [
  "You are the Master Agent for EnerTech Engage (EnerBot).",
  "You own the full conversation. Speak as one continuous assistant — never say you are switching bots.",
  "When a specialist brief is provided below, apply that specialist's expertise for this reply while keeping prior context.",
  "If no specialist brief is provided, answer as the general support master.",
  "Objective: answer the customer satisfactorily using Products catalogue + Knowledge Base. Do not invent facts; do not ignore facts that are in context.",
  "Never tell the customer you are a bot, AI, or that you are escalating to a human. Sound like a helpful EnerTech colleague.",
  "Never ask for name, email, phone, or WhatsApp number — website/WhatsApp session already started and contact is known.",
  "Do not run intake questionnaires (city, location, residential/commercial, feature lists) when the customer asks price, catalogue, or product info.",
  "For product asks: share name, key specs, catalogue/PDF links, and list price when available. If price is missing from context, give a short commercial next step — do not interrogate.",
  "Keep the conversation going. Engage and help. Short answers (Pune, Resident, 3kw, Hybrid) are follow-ups — acknowledge and continue with products.",
].join(" ");

/**
 * Specialist domain from the latest message (not the master).
 * Returns null when the master should handle alone.
 */
function pickSpecialistKey(channel?: string | null, message?: string): string | null {
  const ch = (channel || "").toLowerCase();
  const text = (message || "").toLowerCase();

  if (ch === "email" && /warrant|rma|claim|quot|batter|runtime|install|technical|schematic/.test(text) === false) {
    if (!text.trim()) return "email";
  }

  if (/warrant|rma|\bclaim\b/.test(text)) return "warranty";
  if (/batter(y|ies)|runtime|backup\s*min|\bah\b|kwh/.test(text)) return "battery";
  if (/quot(e|ation)|price\s*list|commercial\s*offer|proforma/.test(text)) return "quotation";
  if (/follow[\s-]?up|nurture|remind/.test(text)) return "followup";
  if (isServiceIntent(text)) return "service";
  if (/schematic|firmware|diagnostic|wiring|three[\s-]?phase|install(ation)?\b/.test(text)) {
    return "technical";
  }
  if (/buy|price|cost|discount|demo|dealer|distributor|\bkva\b|online\s*ups|ups\s*for|which\s*(ups|product)/.test(text)) {
    return "sales";
  }
  if (ch === "email") return "email";
  return null;
}

function isMasterAgent(agent: DbAgent): boolean {
  const cfg = (agent.config || {}) as { is_master?: boolean };
  return Boolean(cfg.is_master) || agent.key === MASTER_AGENT_KEY;
}

export async function loadAgentById(agentId: string): Promise<DbAgent | null> {
  const supabase = createServiceSupabase();
  const { data } = await supabase.from("agents").select("*").eq("id", agentId).maybeSingle();
  return (data as DbAgent) || null;
}

export async function loadAgentByKey(key: string, orgId: string = ORG_ID): Promise<DbAgent | null> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("agents")
    .select("*")
    .eq("org_id", orgId)
    .eq("key", key)
    .maybeSingle();
  return (data as DbAgent) || null;
}

export async function loadMasterAgent(orgId: string = ORG_ID): Promise<DbAgent | null> {
  const supabase = createServiceSupabase();
  const { data: flagged } = await supabase
    .from("agents")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "Active")
    .contains("config", { is_master: true })
    .limit(1)
    .maybeSingle();
  if (flagged) return flagged as DbAgent;

  const support = await loadAgentByKey(MASTER_AGENT_KEY, orgId);
  if (support && support.status === "Active") return support;

  const { data: anyActive } = await supabase
    .from("agents")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "Active")
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (anyActive as DbAgent) || support;
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
}): Promise<AgentStack> {
  const orgId = options.orgId || ORG_ID;
  const master = await loadMasterAgent(orgId);

  const specialistKey = pickSpecialistKey(options.channel, options.message);
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
  const raw = config?.allowed_tools;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((t) => String(t).trim()).filter(Boolean))];
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
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      systemPrompt: `${MASTER_ORCHESTRATION}\n\n${defaultPromptForKey("support")}\n\n${ENGAGEMENT_LOCK}`,
      memoryEnabled: true,
      assigneeLabel: "AI · Master Agent",
      specialistKey: null as string | null,
      allowedTools: [] as string[],
    };
  }

  const owner = master || specialist!;
  const model =
    specialist?.model || master?.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const memoryEnabled = master?.memory_enabled ?? specialist?.memory_enabled ?? true;

  const parts: string[] = [MASTER_ORCHESTRATION];

  if (master) {
    parts.push(`Master role instructions:\n${effectiveSystemPrompt(master)}`);
  }

  if (specialist) {
    parts.push(
      `Specialist brief for this reply (${specialist.name} / ${specialist.key}):\n${effectiveSystemPrompt(specialist)}\nApply this specialist focus for the current user question while staying consistent with the conversation so far.`,
    );
  }

  parts.push(ENGAGEMENT_LOCK);

  const assigneeLabel = specialist
    ? `AI · ${owner.name} → ${specialist.name}`
    : `AI · ${owner.name}`;

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
  };
}
