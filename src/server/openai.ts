import { buildPlaceholderAiReply } from "@/lib/chat-replies";
import {
  openAiToolDefinitions,
  runAiTool,
  type OpenAiToolDef,
} from "@/server/ai-tools";

type HistoryMessage = {
  sender: string;
  body: string;
  created_at: string;
};

type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

type GenerateReplyInput = {
  visitorName: string;
  latestUserMessage: string;
  history: HistoryMessage[];
  knowledgeContext?: string;
  downloadLinks?: Array<{ title: string; url: string }>;
  /** Override from configured AI agent */
  systemPrompt?: string;
  model?: string;
  agentName?: string;
  memoryEnabled?: boolean;
  /** Globally enabled ∩ agent-allowed tool keys */
  toolKeys?: string[];
};

const MAX_TOOL_ROUNDS = 3;

export async function generateOpenAiReply(input: GenerateReplyInput): Promise<{
  reply: string;
  source: "openai" | "fallback";
  model: string;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = input.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const agentLabel = input.agentName || "EnerBot";
  const toolKeys = (input.toolKeys || []).filter(Boolean);
  const tools: OpenAiToolDef[] = openAiToolDefinitions(toolKeys);

  if (!apiKey) {
    return {
      reply: buildPlaceholderAiReply(input.latestUserMessage),
      source: "fallback",
      model,
    };
  }

  const basePrompt =
    input.systemPrompt?.trim() ||
    [
      "You are EnerBot, the customer-facing AI assistant for EnerTech UPS Pvt. Ltd.",
      "Be concise, practical, and businesslike.",
      "You help with UPS selection, battery runtime, service requests, quotations, warranties, installation, and product information.",
    ].join(" ");

  const systemParts = [
    basePrompt,
    `You are acting as: ${agentLabel} for EnerTech UPS Pvt. Ltd.`,
    "If you are uncertain, say so briefly and ask one clarifying question.",
    "Prefer facts from the provided Knowledge Base context when available. Do not invent exact technical specs.",
    "If download links are provided for catalogues/datasheets/PDFs/images, include them clearly in your reply as markdown links.",
    "ONLY use the download URLs provided in “Available download links”. Never invent links and never paste raw supabase.co/storage URLs — those long storage links are forbidden.",
    "If the user asks for a human, confirm that a human support executive will take over.",
    `Visitor: ${input.visitorName}`,
  ];

  if (tools.length > 0) {
    systemParts.push(
      "You may call tools when they improve accuracy (e.g. calculator for runtime math). Prefer Knowledge Base over web search for EnerTech product facts.",
    );
  }

  if (input.knowledgeContext?.trim()) {
    systemParts.push(`Knowledge Base context:\n${input.knowledgeContext.trim()}`);
  }
  if (input.downloadLinks && input.downloadLinks.length > 0) {
    systemParts.push(
      `Available download links:\n${input.downloadLinks.map((l) => `- ${l.title}: ${l.url}`).join("\n")}`,
    );
  }

  const historySlice = input.memoryEnabled === false ? [] : input.history.slice(-12);

  const messages: ChatMessage[] = [
    { role: "system", content: systemParts.join("\n\n") },
    ...historySlice.map((m) => ({
      role: (m.sender === "customer" ? "user" : "assistant") as "user" | "assistant",
      content: m.body,
    })),
    { role: "user", content: input.latestUserMessage },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    let reply = "";

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const body: Record<string, unknown> = {
        model,
        temperature: 0.35,
        max_tokens: 480,
        messages,
      };
      if (tools.length > 0 && round < MAX_TOOL_ROUNDS) {
        body.tools = tools;
        body.tool_choice = "auto";
      }

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${text}`);
      }

      const json = await response.json();
      const message = json?.choices?.[0]?.message as
        | {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }>;
          }
        | undefined;

      const toolCalls = message?.tool_calls?.filter((c) => c?.function?.name) || [];
      if (toolCalls.length > 0 && tools.length > 0) {
        messages.push({
          role: "assistant",
          content: message?.content ?? null,
          tool_calls: toolCalls.map((c) => ({
            id: c.id,
            type: "function",
            function: {
              name: c.function.name,
              arguments: c.function.arguments || "{}",
            },
          })),
        });

        for (const call of toolCalls) {
          const name = call.function.name;
          if (!toolKeys.includes(name)) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ ok: false, error: `Tool ${name} is not allowed` }),
            });
            continue;
          }
          const result = await runAiTool(name, call.function.arguments || "{}");
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result,
          });
        }
        continue;
      }

      reply = typeof message?.content === "string" ? message.content.trim() : "";
      break;
    }

    if (!reply) {
      throw new Error("OpenAI returned an empty reply");
    }

    const { rewriteStorageUrlsInText } = await import("@/server/shorten-urls");
    const shortened = await rewriteStorageUrlsInText(reply);
    return { reply: shortened, source: "openai", model };
  } catch (error) {
    console.error("OpenAI request failed", error);
    let fallback = buildPlaceholderAiReply(input.latestUserMessage);
    if (input.downloadLinks && input.downloadLinks.length > 0) {
      fallback +=
        "\n\nDownloads:\n" +
        input.downloadLinks.map((l) => `• ${l.title}: ${l.url}`).join("\n");
    }
    const { rewriteStorageUrlsInText } = await import("@/server/shorten-urls");
    fallback = await rewriteStorageUrlsInText(fallback);
    return { reply: fallback, source: "fallback", model };
  } finally {
    clearTimeout(timer);
  }
}
