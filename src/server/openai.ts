import { buildPlaceholderAiReply } from "@/lib/chat-replies";

type HistoryMessage = {
  sender: string;
  body: string;
  created_at: string;
};

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
};

export async function generateOpenAiReply(input: GenerateReplyInput): Promise<{
  reply: string;
  source: "openai" | "fallback";
  model: string;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = input.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const agentLabel = input.agentName || "EnerBot";

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
    "If the user asks for a human, confirm that a human support executive will take over.",
    `Visitor: ${input.visitorName}`,
  ];

  if (input.knowledgeContext?.trim()) {
    systemParts.push(`Knowledge Base context:\n${input.knowledgeContext.trim()}`);
  }
  if (input.downloadLinks && input.downloadLinks.length > 0) {
    systemParts.push(
      `Available download links:\n${input.downloadLinks.map((l) => `- ${l.title}: ${l.url}`).join("\n")}`,
    );
  }

  const historySlice = input.memoryEnabled === false ? [] : input.history.slice(-12);

  const messages = [
    { role: "system", content: systemParts.join("\n\n") },
    ...historySlice.map((m) => ({
      role: m.sender === "customer" ? "user" : "assistant",
      content: m.body,
    })),
    { role: "user", content: input.latestUserMessage },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 320,
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${text}`);
    }

    const json = await response.json();
    const content = json?.choices?.[0]?.message?.content;
    const reply = typeof content === "string" ? content.trim() : "";

    if (!reply) {
      throw new Error("OpenAI returned an empty reply");
    }

    return { reply, source: "openai", model };
  } catch (error) {
    console.error("OpenAI request failed", error);
    let fallback = buildPlaceholderAiReply(input.latestUserMessage);
    if (input.downloadLinks && input.downloadLinks.length > 0) {
      fallback +=
        "\n\nDownloads:\n" +
        input.downloadLinks.map((l) => `• ${l.title}: ${l.url}`).join("\n");
    }
    return { reply: fallback, source: "fallback", model };
  } finally {
    clearTimeout(timer);
  }
}
