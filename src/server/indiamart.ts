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
import {
  isAutoSyncDue,
  normalizeDailyTime,
  type AutoSyncSchedule,
  type MarketplaceAutoSyncFields,
} from "@/lib/marketplace-auto-sync";

import { DEFAULT_ORG_ID } from "@/server/org-context";
const PULL_URL = "https://mapi.indiamart.com/wservce/crm/crmListing/v2/";

export type IndiaMartBackfillState = {
  status: "idle" | "running" | "waiting" | "done" | "error" | "cancelled";
  from: string;
  to: string;
  cursor: string;
  chunksTotal: number;
  chunksDone: number;
  fetched: number;
  created: number;
  skipped: number;
  errors: string[];
  lastError?: string | null;
  startedAt?: string;
  updatedAt?: string;
  nextChunkAt?: string | null;
};

export type IndiaMartChannelConfig = MarketplaceAutoSyncFields & {
  crm_key?: string;
  last_sync_at?: string;
  /** Last Pull API call (success or rate-limit) — IndiaMART allows ~1 hit / 5 min */
  last_api_hit_at?: string;
  push_secret?: string;
  backfill?: IndiaMartBackfillState | null;
};

const INDIAMART_PULL_COOLDOWN_MS = 5 * 60 * 1000;
const INDIAMART_CHUNK_MS = 7 * 24 * 60 * 60 * 1000;
const INDIAMART_MAX_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

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
      .eq("org_id", DEFAULT_ORG_ID)
      .eq("type", "indiamart")
      .maybeSingle();
    const cfg = ((data?.config as IndiaMartChannelConfig) || {}) as IndiaMartChannelConfig;
    return {
      crm_key: cfg.crm_key || fromEnv.crm_key,
      last_sync_at: cfg.last_sync_at,
      last_api_hit_at: cfg.last_api_hit_at,
      push_secret: cfg.push_secret || fromEnv.push_secret,
      backfill: cfg.backfill ?? null,
      auto_sync_enabled: Boolean(cfg.auto_sync_enabled),
      auto_sync_schedule: cfg.auto_sync_schedule || "every_6h",
      auto_sync_daily_time: normalizeDailyTime(cfg.auto_sync_daily_time),
      last_auto_sync_at: cfg.last_auto_sync_at,
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
    const msg = json.MESSAGE || json.STATUS || `IndiaMART error code ${code}`;
    if (/5 minutes|every 5 minute|crossed this limit|try again after/i.test(msg)) {
      throw new Error(
        "IndiaMART allows Pull API only once every 5 minutes. Please wait, then Sync again.",
      );
    }
    throw new Error(msg);
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
    .eq("org_id", DEFAULT_ORG_ID)
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
    .eq("org_id", DEFAULT_ORG_ID)
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
      org_id: DEFAULT_ORG_ID,
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
        .eq("org_id", DEFAULT_ORG_ID)
        .eq("email", email)
        .maybeSingle();
      existingCustomer = data as { id: string } | null;
    }
    if (!existingCustomer && phone) {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("org_id", DEFAULT_ORG_ID)
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
          org_id: DEFAULT_ORG_ID,
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
      org_id: DEFAULT_ORG_ID,
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
    org_id: DEFAULT_ORG_ID,
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

export function indiaMartCooldownRemainingMs(cfg: IndiaMartChannelConfig, now = Date.now()): number {
  const hit = cfg.last_api_hit_at || cfg.last_sync_at;
  if (!hit) return 0;
  const elapsed = now - new Date(hit).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return Math.max(0, INDIAMART_PULL_COOLDOWN_MS - elapsed);
}

async function stampIndiaMartApiHit(cfg: IndiaMartChannelConfig) {
  const supabase = createServiceSupabase();
  const hitAt = new Date().toISOString();
  await supabase
    .from("channels")
    .update({
      config: { ...cfg, last_api_hit_at: hitAt },
    })
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("type", "indiamart");
  return hitAt;
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

  const waitMs = indiaMartCooldownRemainingMs(cfg);
  if (waitMs > 0) {
    const mins = Math.ceil(waitMs / 60_000);
    throw new Error(
      `IndiaMART Pull API cooldown: wait about ${mins} more minute${mins === 1 ? "" : "s"} (max 1 sync / 5 min), then try again.`,
    );
  }

  const days = Math.min(Math.max(options?.days ?? 1, 1), 7);
  const end = new Date();
  const start = cfg.last_sync_at
    ? new Date(cfg.last_sync_at)
    : new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  // API max window 7 days
  const maxStart = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const effectiveStart = start < maxStart ? maxStart : start;

  // Stamp before calling so rapid double-clicks still respect cooldown
  const hitAt = await stampIndiaMartApiHit(cfg);
  const cfgWithHit: IndiaMartChannelConfig = { ...cfg, last_api_hit_at: hitAt };

  let enquiries: IndiaMartEnquiry[];
  try {
    enquiries = await pullIndiaMartEnquiries({
      crmKey: cfg.crm_key,
      start: effectiveStart,
      end,
    });
  } catch (err) {
    // Keep last_api_hit_at so we don't hammer the API
    throw err;
  }

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
    ...cfgWithHit,
    last_sync_at: end.toISOString(),
    last_api_hit_at: hitAt,
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
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("type", "indiamart");

  return { fetched: enquiries.length, created, skipped, errors };
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 0);
  return x;
}

function parseInputDate(value: string, endOf = false): Date {
  const raw = value.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00`);
    if (!Number.isFinite(d.getTime())) throw new Error(`Invalid date: ${value}`);
    return endOf ? endOfDay(d) : startOfDay(d);
  }
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

/** Split [from, to] into ≤7-day chunks (IndiaMART Pull max window). */
export function buildIndiaMartChunks(from: Date, to: Date): Array<{ start: Date; end: Date }> {
  if (from.getTime() > to.getTime()) throw new Error("From date must be before To date");
  const chunks: Array<{ start: Date; end: Date }> = [];
  let cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + INDIAMART_CHUNK_MS - 1000, to.getTime()));
    chunks.push({ start: new Date(cursor), end: chunkEnd });
    cursor = new Date(chunkEnd.getTime() + 1000);
  }
  return chunks;
}

async function saveIndiaMartConfig(config: IndiaMartChannelConfig, detail?: string) {
  const supabase = createServiceSupabase();
  const patch: Record<string, unknown> = { config };
  if (detail) patch.detail = detail;
  await supabase.from("channels").update(patch).eq("org_id", DEFAULT_ORG_ID).eq("type", "indiamart");
}

/**
 * Pull one explicit window (must be ≤7 days). Respects 5-minute cooldown.
 */
export async function syncIndiaMartExactWindow(options: {
  start: Date;
  end: Date;
  updateLastSync?: boolean;
}): Promise<{ fetched: number; created: number; skipped: number; errors: string[] }> {
  const cfg = await loadIndiaMartConfig();
  if (!indiaMartConfigReady(cfg) || !cfg.crm_key) {
    throw new Error("IndiaMART CRM key is not configured");
  }

  const span = options.end.getTime() - options.start.getTime();
  if (span < 0) throw new Error("Invalid window");
  if (span > INDIAMART_CHUNK_MS) {
    throw new Error("IndiaMART allows max 7 days per pull — window too large");
  }

  const waitMs = indiaMartCooldownRemainingMs(cfg);
  if (waitMs > 0) {
    const mins = Math.ceil(waitMs / 60_000);
    throw new Error(
      `IndiaMART Pull API cooldown: wait about ${mins} more minute${mins === 1 ? "" : "s"} (max 1 sync / 5 min).`,
    );
  }

  const hitAt = await stampIndiaMartApiHit(cfg);
  const cfgWithHit: IndiaMartChannelConfig = { ...cfg, last_api_hit_at: hitAt };

  const enquiries = await pullIndiaMartEnquiries({
    crmKey: cfg.crm_key,
    start: options.start,
    end: options.end,
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

  const nextConfig: IndiaMartChannelConfig = {
    ...cfgWithHit,
    last_api_hit_at: hitAt,
    last_sync_at: options.updateLastSync === false ? cfg.last_sync_at : options.end.toISOString(),
    backfill: cfg.backfill,
  };
  await saveIndiaMartConfig(
    nextConfig,
    `Last sync ${options.end.toLocaleString()} · +${created} leads`,
  );

  return { fetched: enquiries.length, created, skipped, errors };
}

export async function startIndiaMartBackfill(options: {
  from: string;
  to: string;
}): Promise<{
  ok: boolean;
  chunksTotal: number;
  message: string;
  backfill: IndiaMartBackfillState;
}> {
  const cfg = await loadIndiaMartConfig();
  if (!indiaMartConfigReady(cfg)) {
    throw new Error("IndiaMART CRM key is not configured");
  }
  if (cfg.backfill?.status === "running" || cfg.backfill?.status === "waiting") {
    throw new Error("A backfill is already in progress — wait for it to finish or cancel it");
  }

  const now = Date.now();
  const earliest = new Date(now - INDIAMART_MAX_LOOKBACK_MS);
  let from = parseInputDate(options.from, false);
  let to = parseInputDate(options.to, true);
  if (to.getTime() > now) to = new Date(now);
  if (from.getTime() < earliest.getTime()) {
    from = earliest;
  }
  if (from.getTime() > to.getTime()) {
    throw new Error("From date must be on or before To date (within last 365 days)");
  }

  const chunks = buildIndiaMartChunks(from, to);
  if (chunks.length === 0) throw new Error("No date range to pull");

  const backfill: IndiaMartBackfillState = {
    status: "running",
    from: from.toISOString(),
    to: to.toISOString(),
    cursor: chunks[0].start.toISOString(),
    chunksTotal: chunks.length,
    chunksDone: 0,
    fetched: 0,
    created: 0,
    skipped: 0,
    errors: [],
    lastError: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nextChunkAt: null,
  };

  await saveIndiaMartConfig(
    { ...cfg, backfill },
    `IndiaMART backfill started · ${chunks.length} chunk(s) of ≤7 days`,
  );

  // Try first chunk immediately if cooldown allows
  const tick = await tickIndiaMartBackfill();
  return {
    ok: true,
    chunksTotal: chunks.length,
    message:
      tick.processed
        ? `Backfill started — chunk 1/${chunks.length} done. Remaining chunks run every 5 minutes.`
        : `Backfill queued — ${chunks.length} chunk(s). ${tick.message}`,
    backfill: tick.backfill || backfill,
  };
}

/**
 * Advance backfill by one 7-day chunk when cooldown allows.
 * Safe to call from UI poll or cron every few minutes.
 */
export async function tickIndiaMartBackfill(): Promise<{
  processed: boolean;
  waiting: boolean;
  done: boolean;
  message: string;
  backfill: IndiaMartBackfillState | null;
  cooldownMs: number;
}> {
  const cfg = await loadIndiaMartConfig();
  const bf = cfg.backfill;
  if (!bf || (bf.status !== "running" && bf.status !== "waiting")) {
    return {
      processed: false,
      waiting: false,
      done: bf?.status === "done",
      message: "No active backfill",
      backfill: bf || null,
      cooldownMs: indiaMartCooldownRemainingMs(cfg),
    };
  }

  const cooldownMs = indiaMartCooldownRemainingMs(cfg);
  if (cooldownMs > 0) {
    const next = new Date(Date.now() + cooldownMs).toISOString();
    const waiting: IndiaMartBackfillState = {
      ...bf,
      status: "waiting",
      nextChunkAt: next,
      updatedAt: new Date().toISOString(),
    };
    await saveIndiaMartConfig({ ...cfg, backfill: waiting });
    return {
      processed: false,
      waiting: true,
      done: false,
      message: `Waiting ${Math.ceil(cooldownMs / 60_000)} min for IndiaMART rate limit`,
      backfill: waiting,
      cooldownMs,
    };
  }

  const from = new Date(bf.from);
  const to = new Date(bf.to);
  const chunks = buildIndiaMartChunks(from, to);
  const idx = Math.min(bf.chunksDone, chunks.length);
  if (idx >= chunks.length) {
    const done: IndiaMartBackfillState = {
      ...bf,
      status: "done",
      nextChunkAt: null,
      updatedAt: new Date().toISOString(),
    };
    await saveIndiaMartConfig(
      { ...cfg, backfill: done },
      `IndiaMART backfill complete · +${done.created} leads`,
    );
    return {
      processed: false,
      waiting: false,
      done: true,
      message: "Backfill complete",
      backfill: done,
      cooldownMs: 0,
    };
  }

  const chunk = chunks[idx];
  try {
    // syncIndiaMartExactWindow stamps hit + updates last_sync; preserve backfill after
    const result = await syncIndiaMartExactWindow({
      start: chunk.start,
      end: chunk.end,
      updateLastSync: true,
    });

    const cfgAfter = await loadIndiaMartConfig();
    const nextDone = idx + 1;
    const finished = nextDone >= chunks.length;
    const nextBf: IndiaMartBackfillState = {
      ...bf,
      status: finished ? "done" : "waiting",
      chunksDone: nextDone,
      cursor: finished
        ? bf.to
        : chunks[nextDone].start.toISOString(),
      fetched: bf.fetched + result.fetched,
      created: bf.created + result.created,
      skipped: bf.skipped + result.skipped,
      errors: [...bf.errors, ...result.errors].slice(-20),
      lastError: null,
      updatedAt: new Date().toISOString(),
      nextChunkAt: finished
        ? null
        : new Date(Date.now() + INDIAMART_PULL_COOLDOWN_MS).toISOString(),
    };

    await saveIndiaMartConfig(
      {
        ...cfgAfter,
        backfill: nextBf,
      },
      finished
        ? `IndiaMART backfill complete · +${nextBf.created} leads`
        : `IndiaMART backfill ${nextDone}/${chunks.length} · +${nextBf.created} leads so far`,
    );

    return {
      processed: true,
      waiting: !finished,
      done: finished,
      message: finished
        ? `Backfill complete · ${nextBf.created} new leads`
        : `Chunk ${nextDone}/${chunks.length} done · next in 5 min`,
      backfill: nextBf,
      cooldownMs: INDIAMART_PULL_COOLDOWN_MS,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "chunk failed";
    const errBf: IndiaMartBackfillState = {
      ...bf,
      status: /cooldown|5 min/i.test(msg) ? "waiting" : "error",
      lastError: msg,
      errors: [...bf.errors, msg].slice(-20),
      updatedAt: new Date().toISOString(),
      nextChunkAt: /cooldown|5 min/i.test(msg)
        ? new Date(Date.now() + indiaMartCooldownRemainingMs(cfg)).toISOString()
        : bf.nextChunkAt,
    };
    await saveIndiaMartConfig({ ...cfg, backfill: errBf });
    return {
      processed: false,
      waiting: errBf.status === "waiting",
      done: false,
      message: msg,
      backfill: errBf,
      cooldownMs: indiaMartCooldownRemainingMs(await loadIndiaMartConfig()),
    };
  }
}

export async function cancelIndiaMartBackfill(): Promise<IndiaMartBackfillState | null> {
  const cfg = await loadIndiaMartConfig();
  if (!cfg.backfill) return null;
  const cancelled: IndiaMartBackfillState = {
    ...cfg.backfill,
    status: "cancelled",
    nextChunkAt: null,
    updatedAt: new Date().toISOString(),
  };
  await saveIndiaMartConfig(
    { ...cfg, backfill: cancelled },
    `IndiaMART backfill cancelled · ${cancelled.chunksDone}/${cancelled.chunksTotal} chunks done`,
  );
  return cancelled;
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
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("type", "indiamart")
    .maybeSingle();

  if (existing?.id) {
    return { ok: true, created: false, channelId: existing.id as string };
  }

  const { data: inserted, error } = await supabase
    .from("channels")
    .insert({
      org_id: DEFAULT_ORG_ID,
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
      last_api_hit_at: existing.last_api_hit_at,
      backfill: existing.backfill,
      auto_sync_enabled: existing.auto_sync_enabled,
      auto_sync_schedule: existing.auto_sync_schedule,
      auto_sync_daily_time: existing.auto_sync_daily_time,
      last_auto_sync_at: existing.last_auto_sync_at,
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
      .eq("org_id", DEFAULT_ORG_ID)
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
  let cfg = await loadIndiaMartConfig();

  // Auto-advance backfill when cooldown has elapsed (UI poll / page load)
  if (cfg.backfill && (cfg.backfill.status === "running" || cfg.backfill.status === "waiting")) {
    if (indiaMartCooldownRemainingMs(cfg) === 0) {
      await tickIndiaMartBackfill();
      cfg = await loadIndiaMartConfig();
    }
  }

  const cooldownMs = indiaMartCooldownRemainingMs(cfg);
  const appUrl = process.env.VITE_APP_URL || process.env.APP_URL || "";
  const earliest = new Date(Date.now() - INDIAMART_MAX_LOOKBACK_MS).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  return {
    configured: indiaMartConfigReady(cfg),
    hasCrmKey: Boolean(cfg.crm_key),
    lastSyncAt: cfg.last_sync_at || null,
    lastApiHitAt: cfg.last_api_hit_at || cfg.last_sync_at || null,
    cooldownMs,
    nextSyncAt:
      cooldownMs > 0 ? new Date(Date.now() + cooldownMs).toISOString() : null,
    pushSecretSet: Boolean(cfg.push_secret),
    channelReady: ensured.ok,
    channelCreated: ensured.created,
    channelError: ensured.error || null,
    webhookUrl: appUrl
      ? `${appUrl.replace(/\/$/, "")}/api/webhooks/indiamart`
      : "/api/webhooks/indiamart",
    backfill: cfg.backfill || null,
    backfillEarliestDate: earliest,
    backfillLatestDate: today,
    autoSyncEnabled: Boolean(cfg.auto_sync_enabled),
    autoSyncSchedule: (cfg.auto_sync_schedule || "every_6h") as AutoSyncSchedule,
    autoSyncDailyTime: normalizeDailyTime(cfg.auto_sync_daily_time),
    lastAutoSyncAt: cfg.last_auto_sync_at || null,
  };
});

export const saveIndiaMartAutoSync = createServerFn({ method: "POST" })
  .validator(
    z.object({
      enabled: z.boolean(),
      schedule: z.enum(["hourly", "every_6h", "daily_at"]).optional(),
      dailyTime: z.string().max(8).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const cfg = await loadIndiaMartConfig();
    if (!indiaMartConfigReady(cfg)) {
      throw new Error("Configure IndiaMART CRM key before enabling auto sync");
    }
    const next: IndiaMartChannelConfig = {
      ...cfg,
      auto_sync_enabled: data.enabled,
      auto_sync_schedule: data.schedule || cfg.auto_sync_schedule || "every_6h",
      auto_sync_daily_time: normalizeDailyTime(data.dailyTime ?? cfg.auto_sync_daily_time),
    };
    await saveIndiaMartConfig(
      next,
      data.enabled
        ? `IndiaMART auto sync on (${next.auto_sync_schedule})`
        : "IndiaMART auto sync off — manual Sync only",
    );
    return {
      ok: true,
      autoSyncEnabled: Boolean(next.auto_sync_enabled),
      autoSyncSchedule: next.auto_sync_schedule,
      autoSyncDailyTime: next.auto_sync_daily_time,
      lastAutoSyncAt: next.last_auto_sync_at || null,
    };
  });

/**
 * Cron: if auto sync enabled and due, pull latest window (respects cooldown / backfill).
 */
export async function tickIndiaMartAutoSync(): Promise<{
  ran: boolean;
  skipped?: string;
  created?: number;
  fetched?: number;
}> {
  const cfg = await loadIndiaMartConfig();
  if (!indiaMartConfigReady(cfg)) return { ran: false, skipped: "not_configured" };
  if (!isAutoSyncDue(cfg)) return { ran: false, skipped: "not_due" };
  if (cfg.backfill?.status === "running" || cfg.backfill?.status === "waiting") {
    return { ran: false, skipped: "backfill_active" };
  }
  if (indiaMartCooldownRemainingMs(cfg) > 0) {
    return { ran: false, skipped: "cooldown" };
  }

  try {
    const result = await syncIndiaMartWindow({ days: 1 });
    const latest = await loadIndiaMartConfig();
    await saveIndiaMartConfig({
      ...latest,
      last_auto_sync_at: new Date().toISOString(),
    });
    return {
      ran: true,
      created: result.created,
      fetched: result.fetched,
    };
  } catch (err) {
    return {
      ran: false,
      skipped: err instanceof Error ? err.message : "auto_sync_failed",
    };
  }
}

export const syncIndiaMartLeads = createServerFn({ method: "POST" })
  .validator(z.object({ days: z.number().int().min(1).max(7).optional() }))
  .handler(async ({ data }) => {
    return syncIndiaMartWindow({ days: data.days ?? 1 });
  });

export const startIndiaMartBackfillFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      from: z.string().min(8).max(40),
      to: z.string().min(8).max(40),
    }),
  )
  .handler(async ({ data }) => {
    return startIndiaMartBackfill({ from: data.from, to: data.to });
  });

export const tickIndiaMartBackfillFn = createServerFn({ method: "POST" }).handler(async () => {
  return tickIndiaMartBackfill();
});

export const cancelIndiaMartBackfillFn = createServerFn({ method: "POST" }).handler(async () => {
  return cancelIndiaMartBackfill();
});
