import { buildPlaceholderAiReply } from "@/lib/chat-replies";
import {
  openAiToolDefinitions,
  runAiTool,
  type OpenAiToolDef,
} from "@/server/ai-tools";
import { languageSystemInstruction, offTopicReplyForLang, type SessionLang } from "@/lib/session-language";

function languageInstructionFor(lang?: string): string {
  const l = (lang === "hi" || lang === "mr" || lang === "mixed" || lang === "en" ? lang : "en") as SessionLang;
  return languageSystemInstruction(l);
}

function offTopicExact(lang?: string): string {
  const l = (lang === "hi" || lang === "mr" || lang === "mixed" || lang === "en" ? lang : "en") as SessionLang;
  return offTopicReplyForLang(l);
}

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
  /** When set, photos are delivered as chat images — do not dump Storage URLs. */
  referenceImages?: Array<{ title: string; collection: string }>;
  /** Override from configured AI agent */
  systemPrompt?: string;
  model?: string;
  agentName?: string;
  memoryEnabled?: boolean;
  /** Globally enabled ∩ agent-allowed tool keys */
  toolKeys?: string[];
  /** Session reply language (en / hi / mr / mixed) */
  replyLanguage?: string;
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
    `Stay strictly on EnerTech UPS products and services (sales, catalogues, installation references, service/repair, warranty, battery runtime, quotations). If the user asks anything unrelated (politics, news, general knowledge, other brands, homework, entertainment), reply with ONLY this exact sentence: ${offTopicExact(input.replyLanguage)}`,
    "If you are uncertain about EnerTech facts, or Knowledge Base context has nothing useful for their ask, do NOT invent photos, filenames, or specs. Reply briefly like a colleague that you will send / share it shortly and ask them to wait — never mention knowledge base, missing files, or that you are a bot.",
    "Prefer facts from the provided Knowledge Base context when available. Do not invent exact technical specs.",
    "If download links are provided for catalogues/datasheets/PDFs, include them as markdown links where the link text is exactly the .pdf file name (e.g. [E-Series-Inverter.pdf](url)). Never invent file names or URLs.",
    "ONLY use the download URLs provided in “Available download links”. Never invent links. Never paste supabase.co or /storage/v1/ URLs — those are forbidden and often broken.",
    "If reference photos are being shared as images in chat, reply with ONLY this short line (nothing else): Sir, here are some reference photos. Never invent image markdown, filenames, URLs, or lists like ![photo](123.jpg). Photos appear as real images separately.",
    "Never say you are a bot, AI, or connecting to a human/agent. If the user wants someone to call them or take over, reply like a colleague: ask them to wait briefly and say you will get back shortly. Do not reveal handoff.",
    languageInstructionFor(input.replyLanguage),
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
      `Available download links (use these exact names as markdown link text):\n${input.downloadLinks
        .map((l) => `- [${l.title}](${l.url})`)
        .join("\n")}`,
    );
  }
  if (input.referenceImages && input.referenceImages.length > 0) {
    systemParts.push(
      `The system will attach ${input.referenceImages.length} real reference photo(s) after your message. Your entire reply must be exactly: Sir, here are some reference photos.`,
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
    // Channel handlers (WhatsApp / website) run sanitizeAssistantFileLinks to attach verified links.
    const shortened = await rewriteStorageUrlsInText(reply);
    return { reply: shortened, source: "openai" as const, model };
  } catch (error) {
    console.error("OpenAI request failed", error);
    let fallback = buildPlaceholderAiReply(input.latestUserMessage);
    const { rewriteStorageUrlsInText } = await import("@/server/shorten-urls");
    fallback = await rewriteStorageUrlsInText(fallback);
    return { reply: fallback, source: "fallback" as const, model };
  } finally {
    clearTimeout(timer);
  }
}
