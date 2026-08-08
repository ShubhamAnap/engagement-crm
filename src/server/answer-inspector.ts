import type { RetrievedChunk } from "@/server/knowledge";

export type InspectorSource = {
  title: string;
  score: number;
  url?: string | null;
};

export type AnswerInspectorPayload = {
  confidence: number;
  sources: InspectorSource[];
  metadata: {
    inspector: true;
    hallucination_risk: "Low" | "Medium" | "High";
    reasoning: string[];
    memory: string;
    agent_name: string;
    specialist_key: string | null;
    model: string;
    reply_source: "openai" | "fallback";
    grounded: boolean;
    download_count: number;
  };
};

function uniqueSources(chunks: RetrievedChunk[]): InspectorSource[] {
  const seen = new Set<string>();
  const out: InspectorSource[] = [];
  for (const c of chunks) {
    const key = c.document_title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: c.document_title,
      score: Math.round(c.similarity * 1000) / 1000,
      url: c.download_url || c.source_url,
    });
  }
  return out.slice(0, 6);
}

function confidenceFrom(
  chunks: RetrievedChunk[],
  replySource: "openai" | "fallback",
  productsUseful?: boolean,
): number {
  if (replySource === "fallback") return 0.5;
  if (!chunks.length) {
    // Ungrounded OpenAI answers must not look highly confident
    return productsUseful ? 0.58 : 0.42;
  }
  const top = Math.max(...chunks.map((c) => c.similarity));
  // Map similarity ~0.50–0.95 → confidence ~0.62–0.95
  const mapped = 0.5 + top * 0.45;
  return Math.round(Math.min(0.97, Math.max(0.58, mapped)) * 100) / 100;
}

function riskFrom(confidence: number, grounded: boolean): "Low" | "Medium" | "High" {
  if (!grounded) return "High";
  if (confidence < 0.65) return "High";
  if (confidence < 0.8) return "Medium";
  return "Low";
}

export function buildAnswerInspector(input: {
  chunks: RetrievedChunk[];
  replySource: "openai" | "fallback";
  model: string;
  agentName: string;
  specialistKey?: string | null;
  channel?: string;
  visitorName?: string;
  downloadCount?: number;
  memoryEnabled?: boolean;
  productsUseful?: boolean;
}): AnswerInspectorPayload {
  const sources = uniqueSources(input.chunks);
  const grounded = sources.length > 0 || Boolean(input.productsUseful);
  const confidence = confidenceFrom(input.chunks, input.replySource, input.productsUseful);
  const reasoning: string[] = [
    `Classified channel as ${input.channel || "website"}.`,
    input.specialistKey
      ? `Applied specialist “${input.specialistKey}” under master Support.`
      : `Used master Support agent (${input.agentName}).`,
    sources.length > 0
      ? `Retrieved ${input.chunks.length} knowledge chunk(s); top relevance ${sources[0]?.score ?? "—"}.`
      : input.productsUseful
        ? "No Knowledge Base chunks; Products catalogue provided grounding."
        : "No strong Knowledge Base match — low grounding; prefer wait/check reply over inventing specs.",
    input.replySource === "openai"
      ? `Generated reply with ${input.model}.`
      : "OpenAI unavailable — used fallback reply rules.",
    input.downloadCount
      ? `Attached ${input.downloadCount} catalogue/download link(s).`
      : "No catalogue downloads attached.",
  ];

  const memory = input.memoryEnabled === false
    ? "Memory off for this agent — only the latest turn was used."
    : `Warm memory · visitor ${input.visitorName || "unknown"} · recent thread turns retained.`;

  return {
    confidence,
    sources,
    metadata: {
      inspector: true,
      hallucination_risk: riskFrom(confidence, grounded),
      reasoning,
      memory,
      agent_name: input.agentName,
      specialist_key: input.specialistKey ?? null,
      model: input.model,
      reply_source: input.replySource,
      grounded,
      download_count: input.downloadCount ?? 0,
    },
  };
}
