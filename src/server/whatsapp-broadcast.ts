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
  const to = options.toPhone.replace(/\D/g, "");
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
