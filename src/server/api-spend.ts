/**
 * Best-effort API spend log. Never throw — chat / WhatsApp send must not fail if insert fails.
 */
import { createServiceSupabase } from "@/lib/supabase";

export const SPEND_ORG_ID = "a0000000-0000-4000-8000-000000000001";

export type SpendKind = "openai_chat" | "openai_embed" | "whatsapp_session" | "whatsapp_template";
export type SpendVendor = "openai" | "meta";

export type SpendEventInput = {
  orgId?: string | null;
  kind: SpendKind;
  vendor: SpendVendor;
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  units?: number;
  conversationId?: string | null;
  metadata?: Record<string, unknown>;
};

function asInt(n: unknown, fallback = 0): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return fallback;
  return Math.round(v);
}

export async function recordSpendEvent(input: SpendEventInput): Promise<void> {
  try {
    const orgId = input.orgId || SPEND_ORG_ID;
    const promptTokens = asInt(input.promptTokens);
    const completionTokens = asInt(input.completionTokens);
    const totalTokens = asInt(input.totalTokens, promptTokens + completionTokens);
    const units = Number.isFinite(Number(input.units)) ? Number(input.units) : 1;

    const supabase = createServiceSupabase();
    const metadata: Record<string, unknown> =
      input.metadata && typeof input.metadata === "object" ? { ...input.metadata } : {};

    if (input.kind === "whatsapp_template" && typeof metadata.template_name === "string" && !metadata.category) {
      const { data: tmpl } = await supabase
        .from("wa_message_templates")
        .select("category")
        .eq("org_id", orgId)
        .eq("name", metadata.template_name)
        .maybeSingle();
      if (tmpl?.category) metadata.category = tmpl.category;
    }

    const { error } = await supabase.from("api_spend_events").insert({
      org_id: orgId,
      kind: input.kind,
      vendor: input.vendor,
      model: input.model || null,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      units,
      conversation_id: input.conversationId || null,
      metadata,
    });
    if (error) console.error("api spend log failed", error.message);
  } catch (err) {
    console.error("api spend log failed", err);
  }
}

export function parseOpenAiUsage(json: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const usage =
    json && typeof json === "object" && "usage" in json
      ? (json as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage
      : undefined;
  const promptTokens = asInt(usage?.prompt_tokens);
  const completionTokens = asInt(usage?.completion_tokens);
  const totalTokens = asInt(usage?.total_tokens, promptTokens + completionTokens);
  return { promptTokens, completionTokens, totalTokens };
}
