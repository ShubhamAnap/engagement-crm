/**
 * Conversation Summary Agent — meaningful bilingual follow-up brief for Inbox / Leads / Brainmine.
 * Language policy C: English primary + short native line when customer used non-English.
 * Priority: customer messages first; ignore templates / catalogue PDF noise.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  markBrainmineFollowUpPending,
  nextFollowUpAtIso,
} from "@/lib/follow-up";
import { createServiceSupabase } from "@/lib/supabase";
import {
  ensureLlmGatewaySettingsLoaded,
  requestOpenAiChatCompletion,
  resolveLlmModel,
} from "@/server/llm-gateway";

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
  nextFollowUpAt: string | null;
};

type SummaryMessage = {
  sender: string;
  body: string;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
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

/** Outbound noise that must not drive the CRM follow-up summary. */
export function isOutboundNoiseForSummary(m: SummaryMessage): boolean {
  if (m.sender === "customer" || m.sender === "system") return false;
  const meta =
    m.metadata && typeof m.metadata === "object" && !Array.isArray(m.metadata) ? m.metadata : {};
  if (
    meta.wa_template === true ||
    meta.is_template === true ||
    meta.template === true ||
    typeof meta.template_name === "string" ||
    meta.product_pack === true ||
    meta.kind === "template" ||
    meta.message_kind === "template"
  ) {
    return true;
  }
  const body = String(m.body || "");
  // Catalogue / PDF attachment lines (filename-driven product noise)
  if (/\.pdf\b/i.test(body) && /(catalogue|catalog|brochure|datasheet|spec)/i.test(body)) {
    return true;
  }
  if (/^[A-Z0-9._-]+-catalogue\.pdf$/i.test(body.trim())) return true;
  if (/sent (you )?(the )?(product )?catalogue/i.test(body)) return true;
  if (/here (is|are) (the )?(catalogue|brochure|pdf)/i.test(body)) return true;
  return false;
}

function isGenericOutboundFiller(body: string): boolean {
  const t = body.replace(/\s+/g, " ").trim();
  if (t.length < 12) return false;
  return (
    /feel free to ask/i.test(t) ||
    /thank you for your patience/i.test(t) ||
    /if you have any other questions/i.test(t) ||
    /happy to help/i.test(t)
  );
}

/**
 * Build a customer-weighted transcript for the summary agent.
 * Customer lines first (full); skip templates/PDF packs; keep short useful agent replies only.
 */
export function formatTranscriptForSummary(messages: SummaryMessage[]): string {
  const customerLines: string[] = [];
  const staffLines: string[] = [];

  for (const m of messages) {
    if (m.sender === "system") continue;
    if (isOutboundNoiseForSummary(m)) continue;

    const body = String(m.body || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!body) continue;

    if (m.sender === "customer") {
      customerLines.push(`Customer: ${body.slice(0, 500)}`);
      continue;
    }

    if (isGenericOutboundFiller(body)) continue;
    // Keep short staff replies that may confirm a commitment (callback promised, etc.)
    const who = m.sender === "agent" ? "Agent" : "EnerTech";
    staffLines.push(`${who}: ${body.slice(0, 220)}`);
  }

  // Prefer recent customer asks; keep only a few recent staff replies for context
  const recentCustomers = customerLines.slice(-18);
  const recentStaff = staffLines.slice(-6);

  if (!recentCustomers.length && !recentStaff.length) return "";

  const parts: string[] = [];
  if (recentCustomers.length) {
    parts.push("=== CUSTOMER MESSAGES (primary source — summarize these) ===");
    parts.push(...recentCustomers);
  }
  if (recentStaff.length) {
    parts.push("=== STAFF / AI REPLIES (context only — do not invent needs from these) ===");
    parts.push(...recentStaff);
  }
  return parts.join("\n");
}

function fallbackSummary(transcript: string, leadName?: string | null): string {
  const customerParts = transcript
    .split("\n")
    .filter((l) => /^Customer:/i.test(l))
    .map((l) => l.replace(/^Customer:\s*/i, "").trim())
    .filter(Boolean)
    .slice(-3);
  if (customerParts.length) {
    return clampSummaryToThreeLines(customerParts.join("\n"));
  }
  const parts = transcript
    .split("\n")
    .map((l) => l.replace(/^(Customer|Agent|EnerTech|===.*===):\s*/i, "").trim())
    .filter((l) => l && !l.startsWith("==="))
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
  await ensureLlmGatewaySettingsLoaded();
  const model = resolveLlmModel("conversation.summary");
  if (!process.env.OPENAI_API_KEY) {
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
    "",
    "PRIORITY (strict):",
    "1) CUSTOMER messages are the only source of truth for what the customer wants or asked.",
    "2) IGNORE WhatsApp templates, catalogue/PDF filenames, product-pack sends, and brochure spam — never treat those as the customer's need.",
    "3) Do NOT invent products from staff/AI catalogue sends (e.g. E-O3KW-catalogue.pdf). Only mention a product if the CUSTOMER named it.",
    "4) Prefer the customer's latest real ask (callback, speak to a person by name, quote, site visit, complaint).",
    "",
    "Structure:",
    "Line 1: customer's main ask (who to call, what they requested) — this is mandatory when a customer message exists.",
    "Line 2: product/need ONLY if the customer stated it; otherwise a short next step for sales.",
    "Line 3 (optional): commitment already made by staff/AI, OR one short native quote if customer wrote Hindi/Marathi/other non-English.",
    "",
    "Language: English primary. Do NOT invent products, prices, or promises not in CUSTOMER messages.",
    `Keep under ${CRM_SUMMARY_MAX} characters.`,
  ].join("\n");

  const user = [
    `Lead: ${options.leadName || "—"}`,
    `Company: ${options.company || "—"}`,
    `CRM requirement label (may be outdated — do not override customer messages): ${options.requirement || "—"}`,
    `Channel: ${options.channel || "—"}`,
    "",
    "Transcript (customer-weighted; templates/PDFs already removed):",
    options.transcript || "(empty)",
  ].join("\n");

  try {
    const { message } = await requestOpenAiChatCompletion({
      feature: "conversation.summary",
      model,
      temperature: 0.15,
      maxTokens: 180,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      spendMetadata: { purpose: "conversation_summary" },
    });
    const content = String(message?.content || "").trim();
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
    .select("sender, body, created_at, metadata")
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

  let transcript = formatTranscriptForSummary(
    (messages || []).map((m) => ({
      sender: String(m.sender),
      body: String(m.body || ""),
      created_at: String(m.created_at || ""),
      metadata:
        m.metadata && typeof m.metadata === "object" && !Array.isArray(m.metadata)
          ? (m.metadata as Record<string, unknown>)
          : null,
    })),
  );
  if (!transcript && lead?.notes?.trim()) {
    transcript = `Customer: ${lead.notes.trim()}`;
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
    prevLeadMeta.follow_up_summary_source = generated.source;
    markBrainmineFollowUpPending(prevLeadMeta, ranAt);
    const nextFollowUpAt = nextFollowUpAtIso();
    await supabase
      .from("leads")
      .update({
        metadata: prevLeadMeta,
        next_follow_up_at: nextFollowUpAt,
        last_activity_at: ranAt,
        updated_at: ranAt,
      })
      .eq("id", leadId);

    return {
      conversationId,
      leadId,
      summary: generated.summary,
      source: generated.source,
      model: generated.model,
      nextFollowUpAt,
    };
  }

  return {
    conversationId,
    leadId,
    summary: generated.summary,
    source: generated.source,
    model: generated.model,
    nextFollowUpAt: null,
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
      const ranAt = new Date().toISOString();
      const nextMeta = markBrainmineFollowUpPending({ ...meta, follow_up_summary: ai }, ranAt);
      await supabase
        .from("leads")
        .update({
          metadata: nextMeta,
          next_follow_up_at: nextFollowUpAtIso(),
        })
        .eq("id", leadId);
      return ai;
    }
    const generated = await generateAndStoreConversationSummary(convo.id);
    return generated.summary;
  }

  const notes = typeof lead.notes === "string" ? lead.notes.trim() : "";
  if (notes) {
    const ranAt = new Date().toISOString();
    const summary = clampSummaryToThreeLines(notes);
    await supabase
      .from("leads")
      .update({
        metadata: markBrainmineFollowUpPending(
          {
            ...meta,
            follow_up_summary: summary,
            follow_up_summary_source: "notes",
          },
          ranAt,
        ),
        next_follow_up_at: nextFollowUpAtIso(),
      })
      .eq("id", leadId);
    return summary;
  }

  return null;
}

export const generateConversationSummary = createServerFn({ method: "POST" })
  .validator(z.object({ conversationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    return generateAndStoreConversationSummary(data.conversationId);
  });

/** Human edit of Inbox summary — writes conversation + lead follow-up (marks Brainmine pending). */
export const saveConversationSummary = createServerFn({ method: "POST" })
  .validator(
    z.object({
      conversationId: z.string().uuid(),
      summary: z.string().max(2000),
    }),
  )
  .handler(async ({ data }) => {
    const summary = clampSummaryToThreeLines(data.summary);
    if (!summary) throw new Error("Summary cannot be empty");

    const supabase = createServiceSupabase();
    const { data: convo, error } = await supabase
      .from("conversations")
      .select("id, lead_id, metadata")
      .eq("id", data.conversationId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!convo) throw new Error("Conversation not found");

    const ranAt = new Date().toISOString();
    const prevConvoMeta =
      convo.metadata && typeof convo.metadata === "object" && !Array.isArray(convo.metadata)
        ? { ...(convo.metadata as Record<string, unknown>) }
        : {};
    prevConvoMeta.ai_summary = summary;
    prevConvoMeta.ai_summary_at = ranAt;
    prevConvoMeta.ai_summary_source = "human";

    const { error: convoErr } = await supabase
      .from("conversations")
      .update({ metadata: prevConvoMeta, updated_at: ranAt })
      .eq("id", data.conversationId);
    if (convoErr) throw new Error(convoErr.message);

    const leadId = (convo.lead_id as string | null) || null;
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
      prevLeadMeta.follow_up_summary = summary;
      prevLeadMeta.follow_up_summary_source = "human";
      markBrainmineFollowUpPending(prevLeadMeta, ranAt);
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
      conversationId: data.conversationId,
      leadId,
      summary,
      source: "human" as const,
    };
  });
