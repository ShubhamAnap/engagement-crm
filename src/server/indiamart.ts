/**
 * IndiaMART Lead Manager — Pull API + Push webhook.
 * Fetches enquiries into Leads (+ Inbox threads) for follow-up / remarketing.
 *
 * Key: https://seller.indiamart.com/leadmanager/crmapi
 * Pull: https://mapi.indiamart.com/wservce/crm/crmListing/v2/
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const PULL_URL = "https://mapi.indiamart.com/wservce/crm/crmListing/v2/";

export type IndiaMartChannelConfig = {
  crm_key?: string;
  last_sync_at?: string;
  push_secret?: string;
};

export type IndiaMartEnquiry = {
  UNIQUE_QUERY_ID?: string;
  QUERY_TYPE?: string;
  QUERY_TIME?: string;
  SENDER_NAME?: string;
  SENDER_MOBILE?: string;
  SENDER_EMAIL?: string;
  SENDER_COMPANY?: string;
  SENDER_CITY?: string;
  SENDER_STATE?: string;
  SENDER_COUNTRY_ISO?: string;
  SUBJECT?: string;
  QUERY_MESSAGE?: string;
  QUERY_PRODUCT_NAME?: string;
  QUERY_MCAT_NAME?: string;
  SENDER_ADDRESS?: string;
  SENDER_PINCODE?: string;
  CALL_DURATION?: string;
  RECEIVER_MOBILE?: string;
  [key: string]: unknown;
};

function envConfig(): IndiaMartChannelConfig {
  return {
    crm_key: process.env.INDIAMART_CRM_KEY || undefined,
    push_secret: process.env.INDIAMART_PUSH_SECRET || undefined,
  };
}

export async function loadIndiaMartConfig(): Promise<IndiaMartChannelConfig> {
  const fromEnv = envConfig();
  try {
    const supabase = createServiceSupabase();
    const { data } = await supabase
      .from("channels")
      .select("config, detail")
      .eq("org_id", ORG_ID)
      .eq("type", "indiamart")
      .maybeSingle();
    const cfg = ((data?.config as IndiaMartChannelConfig) || {}) as IndiaMartChannelConfig;
    return {
      crm_key: cfg.crm_key || fromEnv.crm_key,
      last_sync_at: cfg.last_sync_at,
      push_secret: cfg.push_secret || fromEnv.push_secret,
    };
  } catch {
    return fromEnv;
  }
}

export function indiaMartConfigReady(cfg: IndiaMartChannelConfig): boolean {
  return Boolean(cfg.crm_key?.trim());
}

/** IndiaMART Pull API date format: DD-Mon-YYYYHH:MM:SS */
export function formatIndiaMartTime(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dd = String(d.getDate()).padStart(2, "0");
  const mon = months[d.getMonth()];
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${dd}-${mon}-${yyyy}${hh}:${mm}:${ss}`;
}

function queryTypeLabel(code?: string): string {
  switch ((code || "").toUpperCase()) {
    case "W":
      return "Direct Enquiry";
    case "B":
      return "Buy Lead";
    case "P":
      return "PNS Call";
    case "BIZ":
      return "Catalog View";
    case "WA":
      return "WhatsApp Enquiry";
    default:
      return code || "Enquiry";
  }
}

function cleanMobile(raw?: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits || null;
}

export async function pullIndiaMartEnquiries(options: {
  crmKey: string;
  start: Date;
  end: Date;
}): Promise<IndiaMartEnquiry[]> {
  const url = new URL(PULL_URL);
  url.searchParams.set("glusr_crm_key", options.crmKey);
  url.searchParams.set("start_time", formatIndiaMartTime(options.start));
  url.searchParams.set("end_time", formatIndiaMartTime(options.end));

  const res = await fetch(url.toString(), { method: "GET" });
  const json = (await res.json().catch(() => null)) as
    | { CODE?: number | string; STATUS?: string; MESSAGE?: string; RESPONSE?: IndiaMartEnquiry[] | IndiaMartEnquiry | string }
    | IndiaMartEnquiry[]
    | null;

  if (!res.ok) {
    throw new Error(`IndiaMART API error (${res.status})`);
  }

  // API sometimes returns array directly, sometimes wrapped
  if (Array.isArray(json)) return json;

  if (!json || typeof json !== "object") {
    throw new Error("IndiaMART returned an empty response");
  }

  const code = Number(json.CODE);
  if (code && code !== 200) {
    throw new Error(json.MESSAGE || json.STATUS || `IndiaMART error code ${code}`);
  }

  const response = json.RESPONSE;
  if (!response) return [];
  if (typeof response === "string") {
    // e.g. "No leads found"
    return [];
  }
  if (Array.isArray(response)) return response;
  return [response];
}

async function getIndiaMartChannelId(supabase: ReturnType<typeof createServiceSupabase>) {
  const { data } = await supabase
    .from("channels")
    .select("id")
    .eq("org_id", ORG_ID)
    .eq("type", "indiamart")
    .maybeSingle();
  return data?.id as string | undefined;
}

/**
 * Upsert one IndiaMART enquiry as Lead + Inbox conversation for follow-up.
 */
export async function ingestIndiaMartEnquiry(enquiry: IndiaMartEnquiry): Promise<{
  created: boolean;
  skipped: boolean;
  leadId?: string;
  conversationId?: string;
}> {
  const supabase = createServiceSupabase();
  const queryId = String(enquiry.UNIQUE_QUERY_ID || "").trim();
  if (!queryId) {
    return { created: false, skipped: true };
  }

  // Dedupe by IndiaMART unique query id on leads.metadata
  const { data: existingLead } = await supabase
    .from("leads")
    .select("id")
    .eq("org_id", ORG_ID)
    .eq("source", "indiamart")
    .filter("metadata->>indiamart_query_id", "eq", queryId)
    .limit(1)
    .maybeSingle();

  if (existingLead) {
    return { created: false, skipped: true, leadId: existingLead.id as string };
  }

  const name = (enquiry.SENDER_NAME || "IndiaMART Buyer").trim();
  const phone = cleanMobile(enquiry.SENDER_MOBILE);
  const email = enquiry.SENDER_EMAIL?.trim() || null;
  const company = enquiry.SENDER_COMPANY?.trim() || null;
  const product =
    enquiry.QUERY_PRODUCT_NAME?.trim() ||
    enquiry.QUERY_MCAT_NAME?.trim() ||
    enquiry.SUBJECT?.trim() ||
    null;
  const subject = enquiry.SUBJECT?.trim() || product || "IndiaMART enquiry";
  const message =
    enquiry.QUERY_MESSAGE?.trim() ||
    [subject, product ? `Product: ${product}` : null, enquiry.SENDER_CITY ? `City: ${enquiry.SENDER_CITY}` : null]
      .filter(Boolean)
      .join("\n");
  const typeLabel = queryTypeLabel(enquiry.QUERY_TYPE);
  const now = new Date().toISOString();
  const channelId = await getIndiaMartChannelId(supabase);

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .insert({
      org_id: ORG_ID,
      external_ref: `IM-${queryId.slice(-8)}`,
      score: enquiry.QUERY_TYPE === "B" ? 70 : 60,
      status: "New",
      priority: enquiry.QUERY_TYPE === "W" || enquiry.QUERY_TYPE === "WA" ? "High" : "Medium",
      source: "indiamart",
      name,
      company,
      phone,
      email,
      product_label: product,
      last_activity_at: now,
      next_follow_up_at: now,
      metadata: {
        indiamart_query_id: queryId,
        query_type: enquiry.QUERY_TYPE || null,
        query_type_label: typeLabel,
        query_time: enquiry.QUERY_TIME || null,
        city: enquiry.SENDER_CITY || null,
        state: enquiry.SENDER_STATE || null,
        subject,
        remarketing: true,
        raw: enquiry,
      },
    })
    .select("id")
    .single();

  if (leadError) throw new Error(leadError.message);

  // Optional customer row for CRM continuity
  let customerId: string | null = null;
  if (email || phone) {
    let existingCustomer = null as { id: string } | null;
    if (email) {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("org_id", ORG_ID)
        .eq("email", email)
        .maybeSingle();
      existingCustomer = data as { id: string } | null;
    }
    if (!existingCustomer && phone) {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("org_id", ORG_ID)
        .eq("phone", phone)
        .maybeSingle();
      existingCustomer = data as { id: string } | null;
    }
    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const { data: createdCust } = await supabase
        .from("customers")
        .insert({
          org_id: ORG_ID,
          name,
          email,
          phone,
          company,
          metadata: { city: enquiry.SENDER_CITY || null, indiamart: true, source: "indiamart" },
        })
        .select("id")
        .single();
      customerId = (createdCust?.id as string) || null;
    }
    if (customerId) {
      await supabase.from("leads").update({ customer_id: customerId }).eq("id", lead.id);
    }
  }

  const sessionKey = `im:${queryId}`;
  const { data: convo, error: convoError } = await supabase
    .from("conversations")
    .insert({
      org_id: ORG_ID,
      customer_id: customerId,
      lead_id: lead.id,
      channel_id: channelId || null,
      channel: "indiamart",
      external_ref: `IM-${queryId.slice(-6)}`,
      subject: `${typeLabel}: ${subject}`.slice(0, 200),
      preview: message.slice(0, 180),
      status: "human",
      assignee_label: "IndiaMART · Follow-up",
      visitor_name: name,
      visitor_email: email,
      visitor_phone: phone,
      visitor_company: company,
      widget_session_id: sessionKey,
      tags: ["IndiaMART", typeLabel, "Remarketing"],
      unread_count: 1,
      metadata: {
        indiamart_query_id: queryId,
        query_type: enquiry.QUERY_TYPE || null,
        city: enquiry.SENDER_CITY || null,
        remarketing: true,
      },
    })
    .select("id")
    .single();

  if (convoError) throw new Error(convoError.message);

  await supabase.from("messages").insert({
    org_id: ORG_ID,
    conversation_id: convo.id,
    sender: "customer",
    body: message.slice(0, 8000) || subject,
    metadata: {
      indiamart_query_id: queryId,
      query_type: enquiry.QUERY_TYPE || null,
      query_time: enquiry.QUERY_TIME || null,
    },
  });

  try {
    const { fireAutomations } = await import("@/server/automation-engine");
    fireAutomations("indiamart_lead", {
      leadId: lead.id as string,
      conversationId: convo.id as string,
      source: "indiamart",
    });
    fireAutomations("lead_created", {
      leadId: lead.id as string,
      conversationId: convo.id as string,
      source: "indiamart",
    });
  } catch (err) {
    console.error("IndiaMART automation fire failed", err);
  }

  return {
    created: true,
    skipped: false,
    leadId: lead.id as string,
    conversationId: convo.id as string,
  };
}

export async function syncIndiaMartWindow(options?: { days?: number }): Promise<{
  fetched: number;
  created: number;
  skipped: number;
  errors: string[];
}> {
  const cfg = await loadIndiaMartConfig();
  if (!indiaMartConfigReady(cfg) || !cfg.crm_key) {
    throw new Error("IndiaMART CRM key is not configured");
  }

  const days = Math.min(Math.max(options?.days ?? 1, 1), 7);
  const end = new Date();
  const start = cfg.last_sync_at
    ? new Date(cfg.last_sync_at)
    : new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  // API max window 7 days
  const maxStart = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const effectiveStart = start < maxStart ? maxStart : start;

  const enquiries = await pullIndiaMartEnquiries({
    crmKey: cfg.crm_key,
    start: effectiveStart,
    end,
  });

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const enquiry of enquiries) {
    try {
      const result = await ingestIndiaMartEnquiry(enquiry);
      if (result.created) created += 1;
      else skipped += 1;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "ingest failed");
    }
  }

  const supabase = createServiceSupabase();
  const nextConfig: IndiaMartChannelConfig = {
    ...cfg,
    last_sync_at: end.toISOString(),
  };
  await supabase
    .from("channels")
    .update({
      config: nextConfig,
      detail: `Last sync ${end.toLocaleString()} · +${created} leads`,
      status: "Connected",
      is_enabled: true,
      health: 100,
    })
    .eq("org_id", ORG_ID)
    .eq("type", "indiamart");

  return { fetched: enquiries.length, created, skipped, errors };
}

/** Ensure channel row exists (after enum migration). Safe to call repeatedly. */
export async function ensureIndiaMartChannelRow(): Promise<{
  ok: boolean;
  created: boolean;
  channelId?: string;
  error?: string;
}> {
  const supabase = createServiceSupabase();
  const { data: existing } = await supabase
    .from("channels")
    .select("id")
    .eq("org_id", ORG_ID)
    .eq("type", "indiamart")
    .maybeSingle();

  if (existing?.id) {
    return { ok: true, created: false, channelId: existing.id as string };
  }

  const { data: inserted, error } = await supabase
    .from("channels")
    .insert({
      org_id: ORG_ID,
      type: "indiamart",
      name: "IndiaMART",
      status: "Disconnected",
      health: 0,
      detail: "Lead Manager API",
      is_enabled: false,
      config: {},
    })
    .select("id")
    .single();

  if (error) {
    const msg = error.message || "Could not create IndiaMART channel";
    // Most common: enum value missing until 007 is run
    if (/indiamart|invalid input value for enum/i.test(msg)) {
      return {
        ok: false,
        created: false,
        error:
          "Run supabase/migrations/007_indiamart_channel.sql in Supabase SQL Editor, then refresh this page.",
      };
    }
    return { ok: false, created: false, error: msg };
  }

  return { ok: true, created: true, channelId: inserted?.id as string };
}

export const ensureIndiaMartChannel = createServerFn({ method: "POST" }).handler(async () => {
  return ensureIndiaMartChannelRow();
});

export const saveIndiaMartChannelConfig = createServerFn({ method: "POST" })
  .validator(
    z.object({
      crmKey: z.string().min(8).max(500),
      pushSecret: z.string().max(200).optional(),
      enable: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const ensured = await ensureIndiaMartChannelRow();
    if (!ensured.ok) {
      throw new Error(ensured.error || "IndiaMART channel missing — run migration 007");
    }

    const existing = await loadIndiaMartConfig();
    const config: IndiaMartChannelConfig = {
      crm_key: data.crmKey.trim(),
      push_secret: data.pushSecret?.trim() || existing.push_secret,
      last_sync_at: existing.last_sync_at,
    };
    const enable = data.enable ?? true;
    const { data: updated, error } = await supabase
      .from("channels")
      .update({
        config,
        detail: "IndiaMART Lead Manager",
        is_enabled: enable,
        status: enable ? "Connected" : "Disconnected",
        health: enable ? 100 : 0,
        name: "IndiaMART",
      })
      .eq("org_id", ORG_ID)
      .eq("type", "indiamart")
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return {
      ok: true,
      channel: updated,
      webhookPath: "/api/webhooks/indiamart",
      pullDocs: "https://seller.indiamart.com/leadmanager/crmapi",
    };
  });

export const getIndiaMartSetupInfo = createServerFn({ method: "GET" }).handler(async () => {
  const ensured = await ensureIndiaMartChannelRow();
  const cfg = await loadIndiaMartConfig();
  const appUrl = process.env.VITE_APP_URL || process.env.APP_URL || "";
  return {
    configured: indiaMartConfigReady(cfg),
    hasCrmKey: Boolean(cfg.crm_key),
    lastSyncAt: cfg.last_sync_at || null,
    pushSecretSet: Boolean(cfg.push_secret),
    channelReady: ensured.ok,
    channelCreated: ensured.created,
    channelError: ensured.error || null,
    webhookUrl: appUrl
      ? `${appUrl.replace(/\/$/, "")}/api/webhooks/indiamart`
      : "/api/webhooks/indiamart",
  };
});

export const syncIndiaMartLeads = createServerFn({ method: "POST" })
  .validator(z.object({ days: z.number().int().min(1).max(7).optional() }))
  .handler(async ({ data }) => {
    return syncIndiaMartWindow({ days: data.days ?? 1 });
  });
