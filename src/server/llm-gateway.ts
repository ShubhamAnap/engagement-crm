import { parseOpenAiUsage, recordSpendEvent } from "@/server/api-spend";

export type LlmFeature =
  | "agents.reply"
  | "chat.reply"
  | "conversation.summary"
  | "knowledge.embedding";

const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const GATEWAY_CACHE_MS = 15_000;

export type LlmGatewayRuntimePolicy = {
  chatModel: string;
  fallbackModel: string;
  summaryModel: string;
  embeddingModel: string;
};

function envPolicy(): LlmGatewayRuntimePolicy {
  return {
    chatModel: process.env.OPENAI_MODEL || DEFAULT_CHAT_MODEL,
    fallbackModel: process.env.OPENAI_FALLBACK_MODEL || "",
    summaryModel: process.env.OPENAI_MODEL || DEFAULT_CHAT_MODEL,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
  };
}

let runtimePolicy = envPolicy();
let loadedAt = 0;
let loading: Promise<void> | null = null;

export function applyLlmGatewayPolicy(partial: Partial<LlmGatewayRuntimePolicy>) {
  const env = envPolicy();
  runtimePolicy = {
    chatModel: String(partial.chatModel || "").trim() || env.chatModel,
    fallbackModel:
      partial.fallbackModel !== undefined ? String(partial.fallbackModel).trim() : env.fallbackModel,
    summaryModel: String(partial.summaryModel || "").trim() || env.summaryModel,
    embeddingModel: String(partial.embeddingModel || "").trim() || env.embeddingModel,
  };
  loadedAt = Date.now();
}

export async function ensureLlmGatewaySettingsLoaded() {
  if (Date.now() - loadedAt < GATEWAY_CACHE_MS) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const { loadLlmGatewayRuntimePolicy } = await import("./llm-gateway-settings");
      const saved = await loadLlmGatewayRuntimePolicy();
      if (saved) applyLlmGatewayPolicy(saved);
      else loadedAt = Date.now();
    } catch (err) {
      console.error("llm gateway settings cache failed", err);
      loadedAt = Date.now();
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export type GatewayChatMessage =
  | { role: "system" | "user" | "assistant"; content: string | null }
  | { role: "tool"; tool_call_id: string; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };

type ChatTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

type OpenAiChatOptions = {
  model?: string;
  feature?: Exclude<LlmFeature, "knowledge.embedding">;
  messages: GatewayChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ChatTool[];
  toolChoice?: "auto" | "none";
  timeoutMs?: number;
  maxAttempts?: number;
  spendKind?: "openai_chat";
  spendMetadata?: Record<string, unknown>;
  conversationId?: string | null;
  orgId?: string | null;
};

type OpenAiEmbeddingsOptions = {
  model?: string;
  feature?: "knowledge.embedding";
  input: string[];
  timeoutMs?: number;
  maxAttempts?: number;
  spendKind?: "openai_embed";
  spendMetadata?: Record<string, unknown>;
  conversationId?: string | null;
  orgId?: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOpenAiApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return apiKey;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableError(error: Error): boolean {
  return error.name === "AbortError" || /429|5\d\d/.test(error.message);
}

async function withOpenAiRetry<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs: number; maxAttempts: number },
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      return await task(controller.signal);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < options.maxAttempts && isRetryableError(lastError)) {
        await sleep(350 * attempt * attempt);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("OpenAI request failed");
}

async function executeOpenAiChatRequest(
  apiKey: string,
  model: string,
  options: OpenAiChatOptions,
): Promise<unknown> {
  return withOpenAiRetry(
    async (signal) => {
      const body: Record<string, unknown> = {
        model,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 256,
        messages: options.messages,
      };
      if (options.tools?.length) {
        body.tools = options.tools;
        body.tool_choice = options.toolChoice ?? "auto";
      }

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const text = await response.text();
        const error = new Error(`OpenAI API error ${response.status}: ${text}`);
        if (isRetryableStatus(response.status)) throw error;
        throw error;
      }

      return response.json();
    },
    {
      timeoutMs: options.timeoutMs ?? 45_000,
      maxAttempts: options.maxAttempts ?? 3,
    },
  );
}

export async function requestOpenAiChatCompletion(
  options: OpenAiChatOptions,
): Promise<{
  message: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  };
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  raw: unknown;
}> {
  await ensureLlmGatewaySettingsLoaded();
  const apiKey = getOpenAiApiKey();
  const feature = options.feature || "chat.reply";
  const model = resolveLlmModel(feature, options.model);
  const candidates = [model, ...listFallbackModels(feature)];
  let responseJson: unknown = null;
  let chosenModel = model;
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      responseJson = await executeOpenAiChatRequest(apiKey, candidate, options);
      chosenModel = candidate;
      lastError = null;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (candidate === candidates[candidates.length - 1]) throw lastError;
    }
  }
  if (!responseJson) {
    throw lastError || new Error("OpenAI request failed");
  }

  const usage = parseOpenAiUsage(responseJson);
  if (usage.totalTokens > 0 || usage.promptTokens > 0 || usage.completionTokens > 0) {
    void recordSpendEvent({
      orgId: options.orgId,
      conversationId: options.conversationId,
      kind: options.spendKind ?? "openai_chat",
      vendor: "openai",
      model: chosenModel,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      metadata: options.spendMetadata,
    });
  }

  const message =
    (responseJson as { choices?: Array<{ message?: OpenAiChatOptions["messages"][number] }> })?.choices?.[0]
      ?.message || {};

  return {
    message: message as {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    },
    usage,
    raw: responseJson,
  };
}

export async function requestOpenAiEmbeddings(
  options: OpenAiEmbeddingsOptions,
): Promise<{
  embeddings: number[][];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  raw: unknown;
}> {
  await ensureLlmGatewaySettingsLoaded();
  const apiKey = getOpenAiApiKey();
  const feature = options.feature || "knowledge.embedding";
  const model = resolveLlmModel(feature, options.model);
  const responseJson = (await withOpenAiRetry(
    async (signal) => {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: options.input,
        }),
        signal,
      });

      if (!response.ok) {
        const text = await response.text();
        const error = new Error(`OpenAI embeddings error ${response.status}: ${text}`);
        if (isRetryableStatus(response.status)) throw error;
        throw error;
      }

      return response.json();
    },
    {
      timeoutMs: options.timeoutMs ?? 25_000,
      maxAttempts: options.maxAttempts ?? 3,
    },
  )) as {
    data?: Array<{ embedding: number[]; index: number }>;
    usage?: { prompt_tokens?: number; total_tokens?: number };
  };

  const usage = parseOpenAiUsage(responseJson);
  if (usage.totalTokens > 0 || usage.promptTokens > 0) {
    void recordSpendEvent({
      orgId: options.orgId,
      conversationId: options.conversationId,
      kind: options.spendKind ?? "openai_embed",
      vendor: "openai",
      model,
      promptTokens: usage.promptTokens || usage.totalTokens,
      completionTokens: 0,
      totalTokens: usage.totalTokens || usage.promptTokens,
      metadata: options.spendMetadata,
    });
  }

  const rows = responseJson.data ?? [];
  rows.sort((a, b) => a.index - b.index);
  return {
    embeddings: rows.map((row) => row.embedding),
    usage,
    raw: responseJson,
  };
}

export function resolveLlmModel(feature: LlmFeature, override?: string | null): string {
  const direct = String(override || "").trim();
  if (direct && direct !== "org-default") return direct;
  if (feature === "knowledge.embedding") return runtimePolicy.embeddingModel;
  if (feature === "conversation.summary") return runtimePolicy.summaryModel;
  return runtimePolicy.chatModel;
}

export function listFallbackModels(feature: Exclude<LlmFeature, "knowledge.embedding">): string[] {
  const primary = resolveLlmModel(feature);
  const fallback = runtimePolicy.fallbackModel;
  return fallback && fallback !== primary ? [fallback] : [];
}
