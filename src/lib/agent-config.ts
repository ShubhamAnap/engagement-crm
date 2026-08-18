/** Parsed fields from agents.config JSON. */

export type AgentExtraConfig = {
  allowed_tools: string[];
  knowledge_collection_ids: string[];
  product_categories: string[];
  routing_keywords: string[];
  is_master: boolean;
};

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((t) => String(t).trim()).filter(Boolean))];
}

export function parseAgentConfig(config: Record<string, unknown> | null | undefined): AgentExtraConfig {
  const cfg = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  return {
    allowed_tools: stringList(cfg.allowed_tools),
    knowledge_collection_ids: stringList(cfg.knowledge_collection_ids),
    product_categories: stringList(cfg.product_categories),
    routing_keywords: stringList(cfg.routing_keywords),
    is_master: cfg.is_master === true,
  };
}

export function mergeAgentConfig(
  prev: Record<string, unknown> | null | undefined,
  patch: Partial<AgentExtraConfig>,
): Record<string, unknown> {
  const base =
    prev && typeof prev === "object" && !Array.isArray(prev) ? { ...prev } : {};
  if (patch.allowed_tools) base.allowed_tools = patch.allowed_tools;
  if (patch.knowledge_collection_ids) base.knowledge_collection_ids = patch.knowledge_collection_ids;
  if (patch.product_categories) base.product_categories = patch.product_categories;
  if (patch.routing_keywords) base.routing_keywords = patch.routing_keywords;
  return base;
}
