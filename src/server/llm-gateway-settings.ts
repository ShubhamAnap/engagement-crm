/**
 * Admin-editable LLM gateway defaults. Separate from per-agent model on /agents.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { requireStaffUser } from "@/server/staff-auth";
import { AGENT_MODEL_OPTIONS } from "@/lib/agent-prompts";
import { applyLlmGatewayPolicy, type LlmGatewayRuntimePolicy } from "@/server/llm-gateway";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const CHAT_MODELS = new Set<string>(AGENT_MODEL_OPTIONS);
const EMBEDDING_MODELS = new Set(["text-embedding-3-small"]);
const PROVIDERS = ["openai", "anthropic", "google"] as const;

export type LlmProviderId = (typeof PROVIDERS)[number];

export type LlmGatewaySettings = {
  provider: LlmProviderId;
  defaultChatModel: string;
  fallbackModel: string;
  summaryModel: string;
  embeddingModel: string;
  updatedAt: string | null;
  missingTable: boolean;
  openaiConfigured: boolean;
};

function forbidden(message = "Only Admin can manage AI Gateway"): never {
  const err = new Error(message);
  (err as Error & { statusCode: number }).statusCode = 403;
  throw err;
}

async function requireAdmin() {
  const auth = await requireStaffUser();
  if (auth.profile.role !== "Admin") forbidden();
  if (auth.profile.org_id !== ORG_ID) forbidden("Wrong organization");
  return auth;
}

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message || "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    msg.includes("llm_gateway_settings") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

function asProvider(raw: unknown): LlmProviderId {
  const v = String(raw || "openai").trim();
  if (v === "anthropic" || v === "google") return v;
  return "openai";
}

function asChatModel(raw: unknown, fallback = "gpt-4o-mini"): string {
  const v = String(raw || "").trim();
  return CHAT_MODELS.has(v) ? v : fallback;
}

function asEmbeddingModel(raw: unknown): string {
  const v = String(raw || "").trim();
  return EMBEDDING_MODELS.has(v) ? v : "text-embedding-3-small";
}

function envDefaults(missingTable = false): LlmGatewaySettings {
  return {
    provider: "openai",
    defaultChatModel: asChatModel(process.env.OPENAI_MODEL),
    fallbackModel: asChatModel(process.env.OPENAI_FALLBACK_MODEL, ""),
    summaryModel: asChatModel(process.env.OPENAI_MODEL),
    embeddingModel: asEmbeddingModel(process.env.OPENAI_EMBEDDING_MODEL),
    updatedAt: null,
    missingTable,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
  };
}

function rowToSettings(
  row: Record<string, unknown> | null,
  missingTable: boolean,
): LlmGatewaySettings {
  if (!row) return envDefaults(missingTable);
  return {
    provider: asProvider(row.provider),
    defaultChatModel: asChatModel(row.default_chat_model),
    fallbackModel: asChatModel(row.fallback_model, ""),
    summaryModel: asChatModel(row.summary_model),
    embeddingModel: asEmbeddingModel(row.embedding_model),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    missingTable,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
  };
}

export async function loadLlmGatewayRuntimePolicy(): Promise<LlmGatewayRuntimePolicy | null> {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("llm_gateway_settings")
      .select("provider, default_chat_model, fallback_model, summary_model, embedding_model")
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return null;
      console.error("llm gateway settings load failed", error.message);
      return null;
    }
    if (!data) return null;
    const settings = rowToSettings(data as Record<string, unknown>, false);
    return {
      chatModel: settings.defaultChatModel,
      fallbackModel: settings.fallbackModel,
      summaryModel: settings.summaryModel,
      embeddingModel: settings.embeddingModel,
    };
  } catch (err) {
    console.error("llm gateway settings load failed", err);
    return null;
  }
}

export const getLlmGatewaySettings = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("llm_gateway_settings")
    .select("provider, default_chat_model, fallback_model, summary_model, embedding_model, updated_at")
    .eq("org_id", ORG_ID)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) {
      return envDefaults(true);
    }
    throw new Error(error.message);
  }
  const settings = rowToSettings((data as Record<string, unknown> | null) || null, false);
  if (data) {
    applyLlmGatewayPolicy({
      chatModel: settings.defaultChatModel,
      fallbackModel: settings.fallbackModel,
      summaryModel: settings.summaryModel,
      embeddingModel: settings.embeddingModel,
    });
  }
  return settings;
});

export const saveLlmGatewaySettings = createServerFn({ method: "POST" })
  .validator(
    z.object({
      provider: z.enum(PROVIDERS),
      defaultChatModel: z.string().min(1).max(80),
      fallbackModel: z.string().max(80),
      summaryModel: z.string().min(1).max(80),
      embeddingModel: z.string().min(1).max(80),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    if (data.provider !== "openai") {
      throw new Error("Only OpenAI is wired today. Claude and Gemini can be selected after they are connected.");
    }
    const defaultChatModel = asChatModel(data.defaultChatModel);
    const summaryModel = asChatModel(data.summaryModel);
    const embeddingModel = asEmbeddingModel(data.embeddingModel);
    const fallbackRaw = data.fallbackModel.trim() ? asChatModel(data.fallbackModel) : "";
    const fallbackModel = fallbackRaw === defaultChatModel ? "" : fallbackRaw;
    const supabase = createServiceSupabase();
    const payload = {
      org_id: ORG_ID,
      provider: "openai",
      default_chat_model: defaultChatModel,
      fallback_model: fallbackModel,
      summary_model: summaryModel,
      embedding_model: embeddingModel,
      updated_by: auth.profile.id,
      updated_at: new Date().toISOString(),
    };
    const { data: row, error } = await supabase
      .from("llm_gateway_settings")
      .upsert(payload, { onConflict: "org_id" })
      .select("provider, default_chat_model, fallback_model, summary_model, embedding_model, updated_at")
      .single();
    if (error) {
      if (isMissingTable(error)) {
        throw new Error("Run 038_llm_gateway.sql in the Supabase SQL Editor first.");
      }
      throw new Error(error.message);
    }
    const settings = rowToSettings(row as Record<string, unknown>, false);
    applyLlmGatewayPolicy({
      chatModel: settings.defaultChatModel,
      fallbackModel: settings.fallbackModel,
      summaryModel: settings.summaryModel,
      embeddingModel: settings.embeddingModel,
    });
    return settings;
  });
