/**
 * WhatsApp Cloud API — message templates + template sends.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { loadWhatsAppConfig, type WhatsAppChannelConfig } from "@/server/whatsapp";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export type WaTemplateComponent = {
  type: string;
  format?: string;
  text?: string;
  example?: Record<string, unknown>;
  buttons?: Array<Record<string, unknown>>;
};

function requireWaba(cfg: WhatsAppChannelConfig) {
  if (!cfg.access_token) throw new Error("WhatsApp access token is missing. Configure it under Channels → WhatsApp.");
  if (!cfg.business_account_id) {
    throw new Error(
      "WhatsApp Business Account ID (WABA) is required for templates. Set it in Channels → WhatsApp Configure.",
    );
  }
  return cfg as WhatsAppChannelConfig & { access_token: string; business_account_id: string };
}

function mapMetaStatus(status: string | undefined): string {
  const s = (status || "PENDING").toUpperCase();
  if (["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED", "DRAFT"].includes(s)) return s;
  return "PENDING";
}

function extractBody(components: WaTemplateComponent[]): string {
  const body = components.find((c) => c.type?.toUpperCase() === "BODY");
  return body?.text || "";
}

function extractHeader(components: WaTemplateComponent[]): string | null {
  const header = components.find((c) => c.type?.toUpperCase() === "HEADER");
  return header?.text || null;
}

function extractFooter(components: WaTemplateComponent[]): string | null {
  const footer = components.find((c) => c.type?.toUpperCase() === "FOOTER");
  return footer?.text || null;
}

/** Count {{1}} {{2}} placeholders in body. */
export function countTemplateVars(body: string): number {
  const matches = body.match(/\{\{\d+\}\}/g) || [];
  const nums = matches.map((m) => Number(m.replace(/\D/g, ""))).filter(Boolean);
  return nums.length ? Math.max(...nums) : 0;
}

export const syncWhatsAppTemplatesFromMeta = createServerFn({ method: "POST" }).handler(async () => {
  const cfg = requireWaba(await loadWhatsAppConfig());
  const url = `${GRAPH_BASE}/${cfg.business_account_id}/message_templates?limit=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.access_token}` },
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: Array<{
      id?: string;
      name?: string;
      language?: string;
      status?: string;
      category?: string;
      components?: WaTemplateComponent[];
      rejected_reason?: string;
    }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message || `Meta template sync failed (${res.status})`);
  }

  const supabase = createServiceSupabase();
  const rows = json.data || [];
  let upserted = 0;

  for (const t of rows) {
    if (!t.name) continue;
    const components = (t.components || []) as WaTemplateComponent[];
    const payload = {
      org_id: ORG_ID,
      channel_type: "whatsapp",
      name: t.name,
      language: t.language || "en",
      category: (t.category || "MARKETING").toUpperCase(),
      status: mapMetaStatus(t.status),
      body_text: extractBody(components),
      header_text: extractHeader(components),
      footer_text: extractFooter(components),
      components,
      meta_id: t.id || null,
      rejection_reason: t.rejected_reason || null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("wa_message_templates").upsert(payload, {
      onConflict: "org_id,name,language",
    });
    if (error) throw new Error(error.message);
    upserted += 1;
  }

  return { synced: upserted };
});

export const submitWhatsAppTemplateToMeta = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z
        .string()
        .min(1)
        .max(512)
        .regex(/^[a-z0-9_]+$/, "Template name must be lowercase letters, numbers, underscores"),
      language: z.string().min(2).max(12).default("en"),
      category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).default("MARKETING"),
      bodyText: z.string().min(1).max(1024),
      headerText: z.string().max(60).optional(),
      footerText: z.string().max(60).optional(),
      /** Example values for body variables {{1}}, {{2}}, … required by Meta when variables exist */
      bodyExamples: z.array(z.string().min(1)).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const cfg = requireWaba(await loadWhatsAppConfig());
    const varCount = countTemplateVars(data.bodyText);
    if (varCount > 0 && (!data.bodyExamples || data.bodyExamples.length < varCount)) {
      throw new Error(`Provide ${varCount} example value(s) for body variables {{1}}…{{${varCount}}}`);
    }

    const components: WaTemplateComponent[] = [];
    if (data.headerText?.trim()) {
      components.push({ type: "HEADER", format: "TEXT", text: data.headerText.trim() });
    }
    const bodyComp: WaTemplateComponent = { type: "BODY", text: data.bodyText };
    if (varCount > 0) {
      bodyComp.example = { body_text: [data.bodyExamples!.slice(0, varCount)] };
    }
    components.push(bodyComp);
    if (data.footerText?.trim()) {
      components.push({ type: "FOOTER", text: data.footerText.trim() });
    }

    const res = await fetch(`${GRAPH_BASE}/${cfg.business_account_id}/message_templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: data.name,
        language: data.language,
        category: data.category,
        components,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(json.error?.message || `Meta rejected template (${res.status})`);
    }

    const supabase = createServiceSupabase();
    const { data: row, error } = await supabase
      .from("wa_message_templates")
      .upsert(
        {
          org_id: ORG_ID,
          channel_type: "whatsapp",
          name: data.name,
          language: data.language,
          category: data.category,
          status: mapMetaStatus(json.status || "PENDING"),
          body_text: data.bodyText,
          header_text: data.headerText?.trim() || null,
          footer_text: data.footerText?.trim() || null,
          components,
          meta_id: json.id || null,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "org_id,name,language" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export async function sendWhatsAppTemplateMessage(options: {
  toPhone: string;
  templateName: string;
  language: string;
  bodyParams?: string[];
  cfg?: WhatsAppChannelConfig;
}) {
  const config = options.cfg || (await loadWhatsAppConfig());
  if (!config.phone_number_id || !config.access_token) {
    throw new Error("WhatsApp is not configured (phone number id / access token)");
  }
  const to = (await import("@/lib/whatsapp-window")).normalizeWhatsAppDigits(options.toPhone) || options.toPhone.replace(/\D/g, "");
  if (!to) throw new Error("Invalid recipient phone");

  const components: Array<Record<string, unknown>> = [];
  if (options.bodyParams && options.bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: options.bodyParams.map((text) => ({ type: "text", text })),
    });
  }

  const res = await fetch(`${GRAPH_BASE}/${config.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: options.templateName,
        language: { code: options.language },
        ...(components.length ? { components } : {}),
      },
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message || `WhatsApp template send failed (${res.status})`);
  }
  return json.messages?.[0]?.id || null;
}

export const runWhatsAppBroadcast = createServerFn({ method: "POST" })
  .validator(z.object({ broadcastId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const cfg = await loadWhatsAppConfig();
    if (!cfg.phone_number_id || !cfg.access_token) {
      throw new Error("WhatsApp is not configured");
    }

    const { data: broadcast, error: bErr } = await supabase
      .from("broadcasts")
      .select("*")
      .eq("id", data.broadcastId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!broadcast) throw new Error("Broadcast not found");
    if (!broadcast.template_name) throw new Error("Broadcast has no template");

    await supabase
      .from("broadcasts")
      .update({
        status: "Sending",
        started_at: new Date().toISOString(),
      })
      .eq("id", data.broadcastId);

    const { data: recipients, error: rErr } = await supabase
      .from("broadcast_recipients")
      .select("*")
      .eq("broadcast_id", data.broadcastId)
      .eq("status", "pending")
      .limit(500);
    if (rErr) throw new Error(rErr.message);

    const vars = Array.isArray(broadcast.variable_values)
      ? (broadcast.variable_values as string[])
      : [];

    let sent = Number(broadcast.sent_count) || 0;
    let failed = Number(broadcast.failed_count) || 0;

    let bodyText = "";
    if (broadcast.template_id) {
      const { data: tpl } = await supabase
        .from("wa_message_templates")
        .select("body_text")
        .eq("id", broadcast.template_id)
        .maybeSingle();
      bodyText = (tpl?.body_text as string) || "";
    }
    const templateVarCount = countTemplateVars(bodyText);

    for (const recipient of recipients || []) {
      try {
        const bodyParams =
          vars.length > 0
            ? vars
            : templateVarCount === 1 && recipient.name
              ? [String(recipient.name).split(" ")[0] || "Customer"]
              : [];

        const waId = await sendWhatsAppTemplateMessage({
          toPhone: recipient.phone,
          templateName: broadcast.template_name as string,
          language: (broadcast.template_language as string) || "en",
          bodyParams: bodyParams.length ? bodyParams : undefined,
          cfg,
        });

        await supabase
          .from("broadcast_recipients")
          .update({
            status: "sent",
            wa_message_id: waId,
            sent_at: new Date().toISOString(),
            error: null,
          })
          .eq("id", recipient.id);
        sent += 1;
      } catch (err) {
        failed += 1;
        await supabase
          .from("broadcast_recipients")
          .update({
            status: "failed",
            error: err instanceof Error ? err.message : "Send failed",
          })
          .eq("id", recipient.id);
      }
      // Light pacing for Cloud API rate limits
      await new Promise((r) => setTimeout(r, 120));
    }

    await supabase
      .from("broadcasts")
      .update({
        status: failed > 0 && sent === 0 ? "Failed" : "Completed",
        sent_count: sent,
        failed_count: failed,
        completed_at: new Date().toISOString(),
      })
      .eq("id", data.broadcastId);

    return { sent, failed, total: (recipients || []).length };
  });

/**
 * Inbox: send an APPROVED WhatsApp template to the conversation recipient
 * when the 24h free-form window is closed (or for IndiaMART first contact).
 */
export const sendInboxWhatsAppTemplate = createServerFn({ method: "POST" })
  .validator(
    z.object({
      conversationId: z.string().uuid(),
      templateId: z.string().uuid(),
      bodyParams: z.array(z.string().max(500)).max(20).optional(),
      profileId: z.string().uuid().optional(),
      assigneeLabel: z.string().max(120).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const { isMarketplaceLeadChannel, normalizeWhatsAppDigits } = await import(
      "@/lib/whatsapp-window"
    );

    const { data: convo, error: cErr } = await supabase
      .from("conversations")
      .select(
        "id, channel, visitor_phone, visitor_name, metadata, widget_session_id, status, assignee_label",
      )
      .eq("id", data.conversationId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!convo) throw new Error("Conversation not found");

    const channel = String(convo.channel || "");
    if (channel !== "whatsapp" && !isMarketplaceLeadChannel(channel)) {
      throw new Error("Templates can only be sent on WhatsApp / IndiaMART / TradeIndia threads");
    }

    const { data: tpl, error: tErr } = await supabase
      .from("wa_message_templates")
      .select("*")
      .eq("id", data.templateId)
      .eq("org_id", ORG_ID)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!tpl) throw new Error("Template not found");
    if (String(tpl.status).toUpperCase() !== "APPROVED") {
      throw new Error("Only APPROVED templates can be sent. Sync templates from Meta in Broadcasting.");
    }

    const meta = (convo.metadata || {}) as { wa_id?: string };
    const phone =
      normalizeWhatsAppDigits(meta.wa_id) ||
      normalizeWhatsAppDigits(convo.visitor_phone as string) ||
      normalizeWhatsAppDigits(String(convo.widget_session_id || "").replace(/^wa:/, ""));
    if (!phone) throw new Error("No phone number on this conversation for WhatsApp");

    const varCount = countTemplateVars(String(tpl.body_text || ""));
    const params = (data.bodyParams || []).slice(0, varCount);
    if (varCount > 0 && params.length < varCount) {
      throw new Error(`This template needs ${varCount} variable(s). Fill them before sending.`);
    }

    const waMessageId = await sendWhatsAppTemplateMessage({
      toPhone: phone,
      templateName: tpl.name as string,
      language: (tpl.language as string) || "en",
      bodyParams: params,
    });

    let previewBody = String(tpl.body_text || tpl.name || "WhatsApp template");
    params.forEach((val, i) => {
      previewBody = previewBody.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, "g"), val);
    });

    const now = new Date().toISOString();
    const { data: msg, error: mErr } = await supabase
      .from("messages")
      .insert({
        org_id: ORG_ID,
        conversation_id: data.conversationId,
        sender: "agent",
        body: `[Template: ${tpl.name}] ${previewBody}`.slice(0, 8000),
        profile_id: data.profileId || null,
        metadata: {
          whatsapp_template: true,
          template_id: tpl.id,
          template_name: tpl.name,
          template_language: tpl.language,
          wa_message_id: waMessageId,
          body_params: params,
        },
      })
      .select("id")
      .single();
    if (mErr) throw new Error(mErr.message);

    const status = String(convo.status || "");
    const patch: Record<string, unknown> = {
      last_message_at: now,
      preview: previewBody.slice(0, 160),
      updated_at: now,
      assignee_label: data.assigneeLabel || convo.assignee_label || "Human agent",
    };
    if (status === "bot" || status === "ai" || !status) {
      patch.status = "human";
    }
    await supabase.from("conversations").update(patch).eq("id", data.conversationId);

    return {
      ok: true,
      messageId: msg.id as string,
      waMessageId,
      phone,
      templateName: tpl.name as string,
    };
  });
