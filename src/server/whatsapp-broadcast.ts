/**
 * WhatsApp Cloud API — message templates + template sends.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { loadWhatsAppConfig, type WhatsAppChannelConfig } from "@/server/whatsapp";
import {
  analyzeWaTemplateFromRow,
  countTemplateVars,
  isPublicHttpUrl,
} from "@/lib/wa-template-params";

export { countTemplateVars } from "@/lib/wa-template-params";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export type WaTemplateComponent = {
  type: string;
  format?: string;
  text?: string;
  example?: Record<string, unknown>;
  buttons?: Array<Record<string, unknown>>;
};

type MetaTemplateRow = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: WaTemplateComponent[];
  rejected_reason?: string;
  last_updated_time?: string | number;
};

function parseMetaTimestamp(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapMetaStatus(status: string | undefined): string {
  const s = (status || "PENDING").toUpperCase();
  if (s === "ACTIVE") return "APPROVED";
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

function formatMetaError(json: {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
    error_data?: { details?: string };
    type?: string;
  };
}): string {
  const err = json.error;
  const msg = err?.message || "WhatsApp API error";
  const details = err?.error_data?.details || err?.error_user_msg;
  let out = details && !msg.includes(details) ? `${msg} — ${details}` : msg;

  const lower = out.toLowerCase();
  if (
    lower.includes("whatsappbusinessphonenumber") ||
    lower.includes("nonexisting field (message_templates)") ||
    lower.includes("does not support this operation")
  ) {
    out +=
      " Hint: Sync needs the WhatsApp Business Account ID (WABA), not the Phone Number ID. Copy WABA from Meta → WhatsApp → API Setup.";
  } else if (lower.includes("permission") || err?.code === 10 || err?.code === 200) {
    out +=
      " Hint: Access token needs whatsapp_business_management (and usually whatsapp_business_messaging) permission.";
  }
  return out;
}

/** Try to resolve WABA ID from the Cloud API phone number node. */
async function discoverWabaId(phoneNumberId: string, accessToken: string): Promise<string | null> {
  const res = await fetch(
    `${GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}?fields=whatsapp_business_account{id,name}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const json = (await res.json().catch(() => ({}))) as {
    whatsapp_business_account?: { id?: string } | string;
    error?: { message?: string };
  };
  if (!res.ok) return null;
  const waba = json.whatsapp_business_account;
  if (typeof waba === "string" && waba.trim()) return waba.trim();
  if (waba && typeof waba === "object" && waba.id) return String(waba.id).trim();
  return null;
}

async function persistWabaId(wabaId: string, cfg: WhatsAppChannelConfig) {
  try {
    const supabase = createServiceSupabase();
    await supabase
      .from("channels")
      .update({
        config: {
          ...cfg,
          business_account_id: wabaId,
        },
      })
      .eq("org_id", ORG_ID)
      .eq("type", "whatsapp");
  } catch {
    // non-fatal — sync can still proceed with resolved id
  }
}

function maskId(id: string | undefined | null): string | null {
  if (!id) return null;
  const s = String(id);
  if (s.length <= 8) return `${s.slice(0, 2)}…`;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/** Quick probe — validates WABA and returns Meta template count when available. */
async function probeWabaTemplates(
  wabaId: string,
  accessToken: string,
): Promise<{ ok: boolean; count: number; error?: string }> {
  const url = `${GRAPH_BASE}/${encodeURIComponent(wabaId)}/message_templates?limit=1&summary=total_count`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = (await res.json().catch(() => ({}))) as {
    data?: MetaTemplateRow[];
    summary?: { total_count?: number };
    error?: { message?: string; code?: number; error_user_msg?: string; error_data?: { details?: string } };
  };
  if (!res.ok) {
    return { ok: false, count: 0, error: formatMetaError(json) };
  }
  const total = json.summary?.total_count;
  const count = typeof total === "number" ? total : Array.isArray(json.data) ? json.data.length : 0;
  return { ok: true, count };
}

async function resolveWabaConfig(): Promise<{
  cfg: WhatsAppChannelConfig & { access_token: string; business_account_id: string };
  wabaCorrected: boolean;
}> {
  const cfg = await loadWhatsAppConfig();
  if (!cfg.access_token) {
    throw new Error("WhatsApp access token is missing. Configure it under Channels → WhatsApp.");
  }

  const phoneId = (cfg.phone_number_id || "").trim();
  let configured = (cfg.business_account_id || "").trim();
  if (configured && phoneId && configured === phoneId) configured = "";

  let discovered: string | null = null;
  if (phoneId) {
    discovered = await discoverWabaId(phoneId, cfg.access_token);
  }

  let waba = configured || discovered || "";
  let wabaCorrected = false;

  if (configured && discovered && configured !== discovered) {
    const [cfgProbe, discProbe] = await Promise.all([
      probeWabaTemplates(configured, cfg.access_token),
      probeWabaTemplates(discovered, cfg.access_token),
    ]);
    if ((!cfgProbe.ok || cfgProbe.count === 0) && discProbe.ok && discProbe.count > 0) {
      waba = discovered;
      wabaCorrected = true;
      await persistWabaId(waba, { ...cfg, access_token: cfg.access_token });
    }
  } else if (!configured && discovered) {
    waba = discovered;
    wabaCorrected = true;
    await persistWabaId(waba, { ...cfg, access_token: cfg.access_token });
  } else if (configured && !discovered) {
    const cfgProbe = await probeWabaTemplates(configured, cfg.access_token);
    if (!cfgProbe.ok) {
      throw new Error(
        `${cfgProbe.error || "Invalid WhatsApp Business Account ID"} — use WABA from Meta → WhatsApp → API Setup (not Business Manager business_id or Phone Number ID).`,
      );
    }
  }

  if (!waba) {
    throw new Error(
      "WhatsApp Business Account ID (WABA) is required for templates. Set it in Channels → WhatsApp Configure (Meta → WhatsApp → API Setup — not the Phone Number ID).",
    );
  }

  return {
    cfg: { ...cfg, access_token: cfg.access_token, business_account_id: waba },
    wabaCorrected,
  };
}

const TEMPLATE_FIELDS = "name,language,status,category,components,id,rejected_reason,last_updated_time";

async function fetchAllMetaTemplates(wabaId: string, accessToken: string): Promise<MetaTemplateRow[]> {
  const fetchPage = async (withFields: boolean, startUrl?: string | null) => {
    const all: MetaTemplateRow[] = [];
    let url: string | null =
      startUrl ??
      (withFields
        ? `${GRAPH_BASE}/${encodeURIComponent(wabaId)}/message_templates?limit=100&fields=${encodeURIComponent(TEMPLATE_FIELDS)}`
        : `${GRAPH_BASE}/${encodeURIComponent(wabaId)}/message_templates?limit=100`);
    let pages = 0;

    while (url && pages < 20) {
      pages += 1;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: MetaTemplateRow[];
        paging?: { next?: string };
        error?: {
          message?: string;
          code?: number;
          error_subcode?: number;
          error_user_msg?: string;
          error_data?: { details?: string };
          type?: string;
        };
      };
      if (!res.ok) {
        throw new Error(formatMetaError(json) || `Meta template sync failed (${res.status})`);
      }
      if (Array.isArray(json.data)) all.push(...json.data);
      url = json.paging?.next || null;
    }
    return all;
  };

  const withFields = await fetchPage(true);
  if (withFields.length > 0) return withFields;
  return fetchPage(false);
}

export const previewWhatsAppTemplateSync = createServerFn({ method: "GET" }).handler(async () => {
  const cfg = await loadWhatsAppConfig();
  if (!cfg.access_token) {
    throw new Error("WhatsApp access token is missing. Configure it under Channels → WhatsApp.");
  }

  const phoneId = (cfg.phone_number_id || "").trim();
  const configured = (cfg.business_account_id || "").trim();
  const discovered = phoneId ? await discoverWabaId(phoneId, cfg.access_token) : null;

  const [configuredProbe, discoveredProbe, dbCountRes] = await Promise.all([
    configured ? probeWabaTemplates(configured, cfg.access_token) : Promise.resolve(null),
    discovered ? probeWabaTemplates(discovered, cfg.access_token) : Promise.resolve(null),
    createServiceSupabase()
      .from("wa_message_templates")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ORG_ID)
      .eq("channel_type", "whatsapp"),
  ]);

  let sampleNames: string[] = [];
  const bestWaba =
    discoveredProbe?.ok && discoveredProbe.count > 0
      ? discovered
      : configuredProbe?.ok && configuredProbe.count > 0
        ? configured
        : discovered || configured || null;

  if (bestWaba) {
    const rows = await fetchAllMetaTemplates(bestWaba, cfg.access_token);
    sampleNames = rows.slice(0, 8).map((t) => t.name).filter(Boolean) as string[];
  }

  return {
    configuredWaba: maskId(configured),
    discoveredWaba: maskId(discovered),
    configuredTemplateCount: configuredProbe?.count ?? null,
    discoveredTemplateCount: discoveredProbe?.count ?? null,
    configuredWabaValid: configuredProbe?.ok ?? false,
    discoveredWabaValid: discoveredProbe?.ok ?? false,
    wabaMismatch: Boolean(configured && discovered && configured !== discovered),
    recommendedWaba: maskId(bestWaba),
    sampleTemplateNames: sampleNames,
    dbTemplateCount: dbCountRes.count ?? 0,
    dbError: dbCountRes.error?.message ?? null,
  };
});

export const syncWhatsAppTemplatesFromMeta = createServerFn({ method: "POST" }).handler(async () => {
  const { cfg, wabaCorrected } = await resolveWabaConfig();
  const rows = await fetchAllMetaTemplates(cfg.business_account_id, cfg.access_token);

  const supabase = createServiceSupabase();
  let upserted = 0;

  for (const t of rows) {
    if (!t.name) continue;
    const components = (t.components || []) as WaTemplateComponent[];
    const language = t.language || "en";
    const status = mapMetaStatus(t.status);
    const body_text = extractBody(components);
    const header_text = extractHeader(components);
    const footer_text = extractFooter(components);
    const category = (t.category || "MARKETING").toUpperCase();
    const now = new Date().toISOString();
    const metaUpdatedAt = parseMetaTimestamp(t.last_updated_time);

    const { data: existing } = await supabase
      .from("wa_message_templates")
      .select("id, status, body_text, header_text, footer_text, category, updated_at")
      .eq("org_id", ORG_ID)
      .eq("name", t.name)
      .eq("language", language)
      .maybeSingle();

    const contentChanged =
      Boolean(existing) &&
      (existing!.status !== status ||
        (existing!.body_text || "") !== (body_text || "") ||
        (existing!.header_text || "") !== (header_text || "") ||
        (existing!.footer_text || "") !== (footer_text || "") ||
        String(existing!.category || "").toUpperCase() !== category);

    const isNew = !existing;
    const existingUpdatedMs = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;
    const metaUpdatedMs = metaUpdatedAt ? new Date(metaUpdatedAt).getTime() : 0;
    const shouldBumpUpdated =
      isNew || contentChanged || (metaUpdatedMs > 0 && metaUpdatedMs > existingUpdatedMs);

    const payload = {
      org_id: ORG_ID,
      channel_type: "whatsapp",
      name: t.name,
      language,
      category,
      status,
      body_text,
      header_text,
      footer_text,
      components,
      meta_id: t.id || null,
      rejection_reason: t.rejected_reason || null,
      last_synced_at: now,
      // Prefer Meta last_updated_time so newest approved/edited templates float to top.
      updated_at: shouldBumpUpdated ? metaUpdatedAt || now : (existing?.updated_at as string) || now,
    };
    const { error } = await supabase.from("wa_message_templates").upsert(payload, {
      onConflict: "org_id,name,language",
    });
    if (error) throw new Error(`Database save failed: ${error.message}`);
    upserted += 1;
  }

  if (upserted === 0) {
    return {
      synced: 0,
      wabaCorrected,
      warning:
        "Meta returned 0 templates for this WABA. In Channels → WhatsApp, clear the WABA field and click Test connection — it will auto-detect the correct ID from your Phone Number ID. The Business Manager business_id in the URL is not the WABA.",
    };
  }

  const sampleNames = rows
    .slice(0, 5)
    .map((t) => t.name)
    .filter(Boolean) as string[];

  return { synced: upserted, wabaCorrected, sampleNames };
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
    const { cfg } = await resolveWabaConfig();
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
      error?: {
        message?: string;
        code?: number;
        error_user_msg?: string;
        error_data?: { details?: string };
      };
    };
    if (!res.ok) {
      throw new Error(formatMetaError(json) || `Meta rejected template (${res.status})`);
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
  /** Labels for named body params ({{first_name}}); length must match bodyParams when named. */
  bodyParamNames?: string[];
  bodyParamFormat?: "positional" | "named";
  headerFormat?: "IMAGE" | "VIDEO" | "DOCUMENT" | "TEXT" | "LOCATION" | null;
  headerMediaUrl?: string | null;
  headerTextParams?: string[];
  cfg?: WhatsAppChannelConfig;
}) {
  const config = options.cfg || (await loadWhatsAppConfig());
  if (!config.phone_number_id || !config.access_token) {
    throw new Error("WhatsApp is not configured (phone number id / access token)");
  }
  const to =
    (await import("@/lib/whatsapp-window")).normalizeWhatsAppDigits(options.toPhone) ||
    options.toPhone.replace(/\D/g, "");
  if (!to) throw new Error("Invalid recipient phone");

  const components: Array<Record<string, unknown>> = [];
  const headerFormat = (options.headerFormat || "").toUpperCase();

  if (headerFormat === "IMAGE" || headerFormat === "VIDEO" || headerFormat === "DOCUMENT") {
    const link = (options.headerMediaUrl || "").trim();
    if (!link || !isPublicHttpUrl(link)) {
      throw new Error(
        `Template “${options.templateName}” needs a public ${headerFormat.toLowerCase()} URL for the header (Meta error #132012 if missing).`,
      );
    }
    const mediaKey = headerFormat.toLowerCase();
    components.push({
      type: "header",
      parameters: [
        {
          type: mediaKey,
          [mediaKey]: { link },
        },
      ],
    });
  } else if (headerFormat === "TEXT" && options.headerTextParams && options.headerTextParams.length > 0) {
    components.push({
      type: "header",
      parameters: options.headerTextParams.map((text) => ({ type: "text", text })),
    });
  }

  if (options.bodyParams && options.bodyParams.length > 0) {
    const named =
      options.bodyParamFormat === "named" &&
      options.bodyParamNames &&
      options.bodyParamNames.length === options.bodyParams.length;
    components.push({
      type: "body",
      parameters: options.bodyParams.map((text, i) =>
        named
          ? {
              type: "text",
              parameter_name: options.bodyParamNames![i],
              text,
            }
          : { type: "text", text },
      ),
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
    error?: { message?: string; code?: number; error_data?: { details?: string } };
  };
  if (!res.ok) {
    throw new Error(formatMetaError(json) || `WhatsApp template send failed (${res.status})`);
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
    const aud = (broadcast.audience || {}) as Record<string, unknown>;
    const headerMediaUrl =
      typeof aud.header_media_url === "string" ? aud.header_media_url.trim() : "";
    const headerTextParams = Array.isArray(aud.header_text_params)
      ? (aud.header_text_params as string[])
      : [];

    const {
      parseStoredBindings,
      resolveWaBodyParams,
      bindingsAreComplete,
      mergeFieldsFromLeadRow,
      mergeFieldsFromCustomerRow,
    } = await import("@/lib/wa-template-merge");
    type WaMergeFields = import("@/lib/wa-template-merge").WaMergeFields;
    type WaParamBinding = import("@/lib/wa-template-merge").WaParamBinding;

    let sent = Number(broadcast.sent_count) || 0;
    let failed = Number(broadcast.failed_count) || 0;

    let tplRow: {
      body_text?: string | null;
      header_text?: string | null;
      components?: unknown;
    } | null = null;
    if (broadcast.template_id) {
      const { data: tpl } = await supabase
        .from("wa_message_templates")
        .select("body_text, header_text, components")
        .eq("id", broadcast.template_id)
        .maybeSingle();
      tplRow = tpl;
    }
    const spec = analyzeWaTemplateFromRow({
      components: tplRow?.components,
      body_text: tplRow?.body_text || "",
      header_text: tplRow?.header_text,
    });

    const bindings: WaParamBinding[] = parseStoredBindings(
      aud.body_param_bindings,
      spec.bodyVarLabels,
    ).slice(0, spec.bodyVarCount);
    const useBindings =
      Array.isArray(aud.body_param_bindings) &&
      (aud.body_param_bindings as unknown[]).length > 0 &&
      bindingsAreComplete(bindings, spec.bodyVarCount);

    if (spec.headerNeedsMedia && !isPublicHttpUrl(headerMediaUrl)) {
      throw new Error(
        `Template “${broadcast.template_name}” has a ${spec.headerFormat} header. Provide a public media URL before sending (fixes Meta #132012).`,
      );
    }
    if (
      !useBindings &&
      spec.bodyVarCount > 0 &&
      vars.filter((v) => String(v || "").trim()).length < spec.bodyVarCount
    ) {
      throw new Error(
        `Template “${broadcast.template_name}” needs ${spec.bodyVarCount} body variable(s): ${spec.bodyVarLabels
          .map((l) => `{{${l}}}`)
          .join(", ")}`,
      );
    }

    // Prefetch lead/customer rows when merge_fields missing (older campaigns / no 020)
    const leadIds = [
      ...new Set(
        (recipients || [])
          .map((r) => r.lead_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const customerIds = [
      ...new Set(
        (recipients || [])
          .map((r) => r.customer_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const leadMap = new Map<string, WaMergeFields>();
    const customerMap = new Map<string, WaMergeFields>();
    let salesDirectory: Array<{
      email: string;
      display_name: string;
      mobile: string | null;
      is_active: boolean;
    }> = [];
    if (useBindings) {
      const { data: dirRows } = await supabase
        .from("sales_person_directory")
        .select("email, display_name, mobile, is_active")
        .eq("org_id", ORG_ID)
        .eq("is_active", true);
      salesDirectory = (dirRows || []) as typeof salesDirectory;
    }
    if (useBindings && leadIds.length) {
      const { data: leads } = await supabase
        .from("leads")
        .select(
          "id, name, phone, email, company, requirement, sales_person, location, source, status, notes",
        )
        .in("id", leadIds);
      for (const l of leads || []) {
        leadMap.set(l.id as string, mergeFieldsFromLeadRow(l));
      }
    }
    if (useBindings && customerIds.length) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, name, phone, email, company, notes")
        .in("id", customerIds);
      for (const c of customers || []) {
        customerMap.set(c.id as string, mergeFieldsFromCustomerRow(c));
      }
    }

    for (const recipient of recipients || []) {
      try {
        let bodyParams: string[] = [];
        if (useBindings && spec.bodyVarCount > 0) {
          const rawMerge = recipient.merge_fields;
          let fields: WaMergeFields =
            rawMerge && typeof rawMerge === "object" && !Array.isArray(rawMerge)
              ? (rawMerge as WaMergeFields)
              : {};
          if (recipient.lead_id && leadMap.has(recipient.lead_id as string)) {
            fields = { ...leadMap.get(recipient.lead_id as string)!, ...fields };
          } else if (recipient.customer_id && customerMap.has(recipient.customer_id as string)) {
            fields = { ...customerMap.get(recipient.customer_id as string)!, ...fields };
          }
          if (!fields.name && recipient.name) fields = { ...fields, name: recipient.name as string };
          if (!fields.phone && recipient.phone) fields = { ...fields, phone: recipient.phone as string };
          bodyParams = resolveWaBodyParams(bindings, fields, salesDirectory);
        } else if (vars.length > 0) {
          bodyParams = vars.slice(0, spec.bodyVarCount);
        } else if (spec.bodyVarCount === 1 && recipient.name) {
          bodyParams = [String(recipient.name).split(" ")[0] || "Customer"];
        }

        const waId = await sendWhatsAppTemplateMessage({
          toPhone: recipient.phone,
          templateName: broadcast.template_name as string,
          language: (broadcast.template_language as string) || "en",
          bodyParams: bodyParams.length ? bodyParams : undefined,
          bodyParamNames: spec.bodyParamFormat === "named" ? spec.bodyVarLabels : undefined,
          bodyParamFormat: spec.bodyParamFormat,
          headerFormat: spec.headerFormat,
          headerMediaUrl: headerMediaUrl || null,
          headerTextParams: headerTextParams.length ? headerTextParams : undefined,
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
      headerMediaUrl: z.string().url().max(2000).optional(),
      headerTextParams: z.array(z.string().max(500)).max(10).optional(),
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

    const spec = analyzeWaTemplateFromRow(tpl);
    const params = (data.bodyParams || []).slice(0, spec.bodyVarCount);
    if (spec.bodyVarCount > 0 && params.length < spec.bodyVarCount) {
      throw new Error(
        `This template needs ${spec.bodyVarCount} variable(s): ${spec.bodyVarLabels
          .map((l) => `{{${l}}}`)
          .join(", ")}`,
      );
    }
    if (spec.headerNeedsMedia && !isPublicHttpUrl(data.headerMediaUrl || "")) {
      throw new Error(
        `Template “${tpl.name}” needs a public ${String(spec.headerFormat).toLowerCase()} URL for the header.`,
      );
    }

    const waMessageId = await sendWhatsAppTemplateMessage({
      toPhone: phone,
      templateName: tpl.name as string,
      language: (tpl.language as string) || "en",
      bodyParams: params,
      bodyParamNames: spec.bodyParamFormat === "named" ? spec.bodyVarLabels : undefined,
      bodyParamFormat: spec.bodyParamFormat,
      headerFormat: spec.headerFormat,
      headerMediaUrl: data.headerMediaUrl || null,
      headerTextParams: data.headerTextParams,
    });

    let previewBody = String(tpl.body_text || tpl.name || "WhatsApp template");
    if (spec.bodyParamFormat === "named") {
      spec.bodyVarLabels.forEach((label, i) => {
        previewBody = previewBody.replace(
          new RegExp(`\\{\\{\\s*${label}\\s*\\}\\}`, "gi"),
          params[i] || `{{${label}}}`,
        );
      });
    } else {
      params.forEach((val, i) => {
        previewBody = previewBody.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, "g"), val);
      });
    }

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
          header_media_url: data.headerMediaUrl || null,
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
