/** OpenAI embeddings for Knowledge Base RAG (pgvector / 1536 dims). */
import {
  ensureLlmGatewaySettingsLoaded,
  requestOpenAiEmbeddings,
  resolveLlmModel,
} from "@/server/llm-gateway";

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured — required for Knowledge Base embeddings");
  }
  if (texts.length === 0) return [];

  await ensureLlmGatewaySettingsLoaded();
  const model = resolveLlmModel("knowledge.embedding");
  const { embeddings } = await requestOpenAiEmbeddings({
    feature: "knowledge.embedding",
    model,
    input: texts.map((t) => t.slice(0, 8000)),
    spendMetadata: { purpose: "embed", texts: texts.length },
  });
  return embeddings;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  if (!vector) throw new Error("Failed to embed query");
  return vector;
}

export function chunkText(text: string, chunkSize = 900, overlap = 140): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) return [];
  if (cleaned.length <= chunkSize) return [cleaned];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + chunkSize, cleaned.length);
    if (end < cleaned.length) {
      const slice = cleaned.slice(start, end);
      const breakAt = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "), slice.lastIndexOf(" "));
      if (breakAt > chunkSize * 0.4) end = start + breakAt + 1;
    }
    const part = cleaned.slice(start, end).trim();
    if (part) chunks.push(part);
    if (end >= cleaned.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
