/** OpenAI embeddings for Knowledge Base RAG (pgvector / 1536 dims). */
import { parseOpenAiUsage, recordSpendEvent } from "@/server/api-spend";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured — required for Knowledge Base embeddings");
  }
  if (texts.length === 0) return [];

  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const maxAttempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: texts.map((t) => t.slice(0, 8000)),
        }),
        signal: controller.signal,
      });

      if (response.status === 429 || response.status >= 500) {
        const body = await response.text();
        lastError = new Error(`OpenAI embeddings error ${response.status}: ${body}`);
        if (attempt < maxAttempts) {
          await sleep(400 * attempt * attempt);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI embeddings error ${response.status}: ${body}`);
      }

      const json = (await response.json()) as {
        data?: Array<{ embedding: number[]; index: number }>;
        usage?: { prompt_tokens?: number; total_tokens?: number };
      };
      const usage = parseOpenAiUsage(json);
      if (usage.totalTokens > 0 || usage.promptTokens > 0) {
        void recordSpendEvent({
          kind: "openai_embed",
          vendor: "openai",
          model,
          promptTokens: usage.promptTokens || usage.totalTokens,
          completionTokens: 0,
          totalTokens: usage.totalTokens || usage.promptTokens,
          metadata: { purpose: "embed", texts: texts.length },
        });
      }
      const rows = json.data ?? [];
      rows.sort((a, b) => a.index - b.index);
      return rows.map((r) => r.embedding);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts && (lastError.name === "AbortError" || /429|5\d\d/.test(lastError.message))) {
        await sleep(400 * attempt * attempt);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("OpenAI embeddings failed");
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
