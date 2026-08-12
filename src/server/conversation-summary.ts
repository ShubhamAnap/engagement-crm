/**
 * Conversation Summary Agent — meaningful bilingual follow-up brief for Inbox / Leads / Brainmine.
 * Language policy C: English primary + short native line when customer used non-English.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const MAX_MESSAGES = 40;
/** ~2–3 short UI / CRM lines */
const CRM_SUMMARY_MAX = 280;

export type ConversationSummaryResult = {
  conversationId: string;
  leadId: string | null;
  summary: string;
  source: "openai" | "fallback";
  model: string;
};

/** Enforce max 2–3 lines for Inbox / Leads / Brainmine Description. */
export function clampSummaryToThreeLines(raw: string, maxChars = CRM_SUMMARY_MAX): string {
  const cleaned = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return "";
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  let out = lines.join("\n");
  if (out.length > maxChars) {
    out = `${out.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }
  return out;
}

function formatTranscript(
  messages: Array<{ sender: string; body: string; created_at?: string }>,
): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.sender === "system") continue;
    const body = String(m.body || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!body) continue;
    const who =
      m.sender === "customer" ? "Customer" : m.sender === "agent" ? "Agent" : "EnerTech";
    lines.push(`${who}: ${body.slice(0, 400)}`);
  }
  return lines.join("\n");
}

function fallbackSummary(transcript: string, leadName?: string | null): string {
  const parts = transcript
    .split("\n")
    .map((l) => l.replace(/^(Customer|Agent|EnerTech):\s*/i, "").trim())
    .filter(Boolean)
    .slice(-4);
  const body = parts.join(" · ");
  if (body) return clampSummaryToThreeLines(body);
  return leadName
    ? `Follow-up needed for ${leadName}.`
    : "Follow-up needed — no chat details yet.";
}

async function callOpenAiSummary(options: {
  transcript: string;
  leadName?: string | null;
  company?: string | null;
  requirement?: string | null;
  channel?: string | null;
}): Promise<{ summary: string; source: "openai" | "fallback"; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) {
    return {
      summary: fallbackSummary(options.transcript, options.leadName),
      source: "fallback",
      model,
    };
  }

  const system = [
    "You are the EnerTech Engage Conversation Summary Agent for EnerTech UPS Pvt. Ltd.",
    "Write a factual follow-up brief for sales and CRM Description.",
    "HARD LIMIT: maximum 2 to 3 short lines total. No headings, no bullet lists, no labels like Need:/Key asks:.",
    "Line 1: what the customer wants (product/need).",
    "Line 2: key ask or urgency (callback, quote, etc.) and any commitment already made.",
    "Line 3 (optional): next step — OR if customer wrote Hindi/Marathi/other non-English, one short native quote of their ask.",
    "Language: English primary. Do NOT invent products, prices, or promises not in the transcript.",
    `Keep under ${CRM_SUMMARY_MAX} characters.`,
  ].join("\n");

  const user = [
    `Lead: ${options.leadName || "—"}`,
    `Company: ${options.company || "—"}`,
    `Requirement label: ${options.requirement || "—"}`,
    `Channel: ${options.channel || "—"}`,
    "",
    "Transcript:",
    options.transcript || "(empty)",
  ].join("\n");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 180,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("summary openai error", res.status, errText.slice(0, 200));
      return {
        summary: fallbackSummary(options.transcript, options.leadName),
        source: "fallback",
        model,
      };
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = String(json.choices?.[0]?.message?.content || "").trim();
    if (!content) {
      return {
        summary: fallbackSummary(options.transcript, options.leadName),
        source: "fallback",
        model,
      };
    }
    return {
      summary: clampSummaryToThreeLines(content),
      source: "openai",
      model,
    };
  } catch (err) {
    console.error("summary openai exception", err);
    return {
      summary: fallbackSummary(options.transcript, options.leadName),
      source: "fallback",
      model,
    };
  }
}

export async function generateAndStoreConversationSummary(
  conversationId: string,
): Promise<ConversationSummaryResult> {
  const supabase = createServiceSupabase();
  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .select(
      "id, org_id, lead_id, channel, visitor_name, metadata, lead:leads(id, name, company, requirement, product_label, notes, metadata)",
    )
    .eq("id", conversationId)
    .eq("org_id", ORG_ID)
    .maybeSingle();
  if (convoErr) throw new Error(convoErr.message);
  if (!convo) throw new Error("Conversation not found");

  const { data: messages, error: msgErr } = await supabase
    .from("messages")
    .select("sender, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES);
  if (msgErr) throw new Error(msgErr.message);

  const leadRaw = convo.lead as
    | {
        id: string;
        name?: string | null;
        company?: string | null;
        requirement?: string | null;
        product_label?: string | null;
        notes?: string | null;
        metadata?: Record<string, unknown> | null;
      }
    | {
        id: string;
        name?: string | null;
        company?: string | null;
        requirement?: string | null;
        product_label?: string | null;
        notes?: string | null;
        metadata?: Record<string, unknown> | null;
      }[]
    | null;
  const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;

  let transcript = formatTranscript(
    (messages || []).map((m) => ({
      sender: String(m.sender),
      body: String(m.body || ""),
      created_at: String(m.created_at || ""),
    })),
  );
  if (!transcript && lead?.notes?.trim()) {
    transcript = `Note: ${lead.notes.trim()}`;
  }

  const generated = await callOpenAiSummary({
    transcript,
    leadName: lead?.name || convo.visitor_name,
    company: lead?.company,
    requirement: lead?.requirement || lead?.product_label,
    channel: convo.channel,
  });

  const ranAt = new Date().toISOString();
  const prevConvoMeta =
    convo.metadata && typeof convo.metadata === "object" && !Array.isArray(convo.metadata)
      ? { ...(convo.metadata as Record<string, unknown>) }
      : {};
  prevConvoMeta.ai_summary = generated.summary;
  prevConvoMeta.ai_summary_at = ranAt;
  prevConvoMeta.ai_summary_source = generated.source;
  prevConvoMeta.ai_summary_model = generated.model;

  await supabase
    .from("conversations")
    .update({ metadata: prevConvoMeta, updated_at: ranAt })
    .eq("id", conversationId);

  const leadId = (convo.lead_id as string | null) || lead?.id || null;
  if (leadId) {
    const { data: leadRow } = await supabase
      .from("leads")
      .select("metadata")
      .eq("id", leadId)
      .maybeSingle();
    const prevLeadMeta =
      leadRow?.metadata && typeof leadRow.metadata === "object" && !Array.isArray(leadRow.metadata)
        ? { ...(leadRow.metadata as Record<string, unknown>) }
        : {};
    prevLeadMeta.follow_up_summary = generated.summary;
    prevLeadMeta.follow_up_summary_at = ranAt;
    prevLeadMeta.follow_up_summary_source = generated.source;
    await supabase
      .from("leads")
      .update({
        metadata: prevLeadMeta,
        last_activity_at: ranAt,
        updated_at: ranAt,
      })
      .eq("id", leadId);
  }

  return {
    conversationId,
    leadId,
    summary: generated.summary,
    source: generated.source,
    model: generated.model,
  };
}

/** Ensure lead has follow_up_summary — generate from linked conversation when missing. */
export async function ensureLeadFollowUpSummary(leadId: string): Promise<string | null> {
  const supabase = createServiceSupabase();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, notes, metadata")
    .eq("id", leadId)
    .eq("org_id", ORG_ID)
    .maybeSingle();
  if (!lead) return null;

  const meta =
    lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata)
      ? (lead.metadata as Record<string, unknown>)
      : {};
  const existing = typeof meta.follow_up_summary === "string" ? meta.follow_up_summary.trim() : "";
  if (existing) return existing;

  const { data: convo } = await supabase
    .from("conversations")
    .select("id, metadata")
    .eq("org_id", ORG_ID)
    .eq("lead_id", leadId)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (convo?.id) {
    const convoMeta =
      convo.metadata && typeof convo.metadata === "object" && !Array.isArray(convo.metadata)
        ? (convo.metadata as Record<string, unknown>)
        : {};
    const ai = typeof convoMeta.ai_summary === "string" ? convoMeta.ai_summary.trim() : "";
    if (ai) {
      await supabase
        .from("leads")
        .update({
          metadata: { ...meta, follow_up_summary: ai, follow_up_summary_at: new Date().toISOString() },
        })
        .eq("id", leadId);
      return ai;
    }
    const generated = await generateAndStoreConversationSummary(convo.id);
    return generated.summary;
  }

  const notes = typeof lead.notes === "string" ? lead.notes.trim() : "";
  if (notes) {
    await supabase
      .from("leads")
      .update({
        metadata: {
          ...meta,
          follow_up_summary: clampSummaryToThreeLines(notes),
          follow_up_summary_at: new Date().toISOString(),
          follow_up_summary_source: "notes",
        },
      })
      .eq("id", leadId);
    return clampSummaryToThreeLines(notes);
  }

  return null;
}

export const generateConversationSummary = createServerFn({ method: "POST" })
  .validator(z.object({ conversationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    return generateAndStoreConversationSummary(data.conversationId);
  });
