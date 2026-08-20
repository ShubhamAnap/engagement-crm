/**
 * TradeIndia — My Inquiry API (pull).
 * Docs: Dashboard → Inquiries & Contacts → My Inquiry API
 * GET https://www.tradeindia.com/utils/my_inquiry.html
 *   ?userid=&profile_id=&key=&from_date=&to_date=&limit=&page_no=
 *
 * Store credentials in Channels → TradeIndia (or env TRADEINDIA_*).
 * Never commit real keys.
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

import { allowEnvChannelFallback, resolveServiceOrgId } from "@/server/org-context";
const PULL_URL = "https://www.tradeindia.com/utils/my_inquiry.html";

export type TradeIndiaBackfillState = {
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

export type TradeIndiaChannelConfig = MarketplaceAutoSyncFields & {
  userid?: string;
  profile_id?: string;
  key?: string;
  last_sync_at?: string;
  /** Last Pull API call — polite gap between day chunks */
  last_api_hit_at?: string;
  backfill?: TradeIndiaBackfillState | null;
};

/** Polite gap between day pulls (TradeIndia has no published 5‑min rule like IndiaMART). */
const TRADEINDIA_PULL_COOLDOWN_MS = 60 * 1000;
const TRADEINDIA_DAY_MS = 24 * 60 * 60 * 1000;
const TRADEINDIA_MAX_LOOKBACK_MS = 365 * TRADEINDIA_DAY_MS;

export type TradeIndiaEnquiry = {
  rfi_id?: string | number;
  inquiry_id?: string | number;
  sender_uid?: string | number;
  sender_name?: string;
  sender_co?: string;
  sender_company?: string;
  sender_email?: string;
  sender_mobile?: string;
  sender_other_mobiles?: string;
  sender_city?: string;
  sender_state?: string;
  sender_country?: string;
  product_name?: string;
  product_id?: string;
  message?: string;
  inquiry_message?: string;
  subject?: string;
  inquiry_type?: string;
  source?: string;
  quantity?: string;
  generated_date?: string;
  generated_time?: string;
  inquiry_date?: string;
  view_status?: string;
  [key: string]: unknown;
};

function envConfig(): TradeIndiaChannelConfig {
  return {
    userid: process.env.TRADEINDIA_USERID || undefined,
    profile_id: process.env.TRADEINDIA_PROFILE_ID || undefined,
    key: process.env.TRADEINDIA_API_KEY || undefined,
  };
}

export async function loadTradeIndiaConfig(): Promise<TradeIndiaChannelConfig> {
  const orgId = await resolveServiceOrgId();
  const fromEnv = allowEnvChannelFallback(orgId) ? envConfig() : {};
  try {
    const supabase = createServiceSupabase();
    const { data } = await supabase
      .from("channels")
      .select("config")
      .eq("org_id", orgId)
      .eq("type", "tradeindia")
      .maybeSingle();
    const cfg = ((data?.config as TradeIndiaChannelConfig) || {}) as TradeIndiaChannelConfig;
    return {
      userid: cfg.userid || fromEnv.userid,
      profile_id: cfg.profile_id || fromEnv.profile_id,
      key: cfg.key || fromEnv.key,
      last_sync_at: cfg.last_sync_at,
      last_api_hit_at: cfg.last_api_hit_at,
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

export function tradeIndiaConfigReady(cfg: TradeIndiaChannelConfig): boolean {
  return Boolean(cfg.userid?.trim() && cfg.profile_id?.trim() && cfg.key?.trim());
}

/** TradeIndia typically expects YYYY-MM-DD */
export function formatTradeIndiaDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function asString(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** TradeIndia messages often include HTML tel: links — strip for CRM notes. */
function stripHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanMobile(raw?: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits || null;
}

function enquiryId(row: TradeIndiaEnquiry): string {
  return asString(row.rfi_id || row.inquiry_id);
}

function displayName(enquiry: TradeIndiaEnquiry): string {
  const name = asString(enquiry.sender_name);
  if (name) return name;
  const co = asString(enquiry.sender_co) || asString(enquiry.sender_company);
  if (co && !/^numbermasking/i.test(co)) return co;
  return "TradeIndia Buyer";
}

function inquiryTypeLabel(code?: string): string {
  const c = (code || "").toUpperCase();
  if (c === "BUY") return "Buy lead";
  if (c === "UNMODERATED") return "Unmoderated";
  return code || "Enquiry";
}

function normalizeList(json: unknown): TradeIndiaEnquiry[] {
  if (!json) return [];
  if (Array.isArray(json)) return json as TradeIndiaEnquiry[];
  if (typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;
  for (const key of ["inquiries", "inquiry", "data", "results", "RESPONSE", "response", "leads"]) {
    const v = obj[key];
    if (Array.isArray(v)) return v as TradeIndiaEnquiry[];
    if (v && typeof v === "object" && !Array.isArray(v)) return [v as TradeIndiaEnquiry];
  }
  // Single enquiry object with rfi_id
  if (obj.rfi_id != null || obj.inquiry_id != null || obj.sender_name != null) {
    return [obj as TradeIndiaEnquiry];
  }
  return [];
}

export async function pullTradeIndiaEnquiries(options: {
  userid: string;
  profileId: string;
  key: string;
  from: Date;
  to: Date;
  limit?: number;
}): Promise<TradeIndiaEnquiry[]> {
  const all: TradeIndiaEnquiry[] = [];
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  let page = 1;
  const maxPages = 20;

  while (page <= maxPages) {
    const url = new URL(PULL_URL);
    url.searchParams.set("userid", options.userid);
    url.searchParams.set("profile_id", options.profileId);
    url.searchParams.set("key", options.key);
    url.searchParams.set("from_date", formatTradeIndiaDate(options.from));
    url.searchParams.set("to_date", formatTradeIndiaDate(options.to));
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("page_no", String(page));

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Sometimes HTML error page
      if (!res.ok) throw new Error(`TradeIndia API error (${res.status})`);
      throw new Error("TradeIndia returned a non-JSON response — check userid / profile_id / key");
    }

    if (!res.ok) {
      const msg =
        json && typeof json === "object" && "message" in json
          ? String((json as { message?: string }).message)
          : `TradeIndia API error (${res.status})`;
      throw new Error(msg);
    }

    // Error payloads
    if (json && typeof json === "object" && !Array.isArray(json)) {
      const o = json as Record<string, unknown>;
      const errMsg = asString(o.error || o.Error || o.message || o.MESSAGE);
      const code = o.code ?? o.CODE ?? o.status;
      if (errMsg && (code === 0 || code === "0" || /invalid|denied|unauthorized|fail/i.test(errMsg))) {
        throw new Error(errMsg);
      }
      if (errMsg && /no (inquiry|lead|record)/i.test(errMsg)) {
        break;
      }
    }

    const batch = normalizeList(json);
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < limit) break;
    page += 1;
  }

  return all;
}

async function getTradeIndiaChannelId(supabase: ReturnType<typeof createServiceSupabase>) {
  const { data } = await supabase
    .from("channels")
    .select("id")
    .eq("org_id", await resolveServiceOrgId())
    .eq("type", "tradeindia")
    .maybeSingle();
  return data?.id as string | undefined;
}

export async function ingestTradeIndiaEnquiry(enquiry: TradeIndiaEnquiry): Promise<{
  created: boolean;
  skipped: boolean;
  leadId?: string;
  conversationId?: string;
}> {
  const supabase = createServiceSupabase();
  const queryId = enquiryId(enquiry);
  if (!queryId) {
    return { created: false, skipped: true };
  }

  const { data: existingLead } = await supabase
    .from("leads")
    .select("id")
    .eq("org_id", await resolveServiceOrgId())
    .eq("source", "tradeindia")
    .filter("metadata->>tradeindia_rfi_id", "eq", queryId)
    .limit(1)
    .maybeSingle();

  if (existingLead) {
    return { created: false, skipped: true, leadId: existingLead.id as string };
  }

  const name = displayName(enquiry);
  const phone = cleanMobile(
    asString(enquiry.sender_mobile) || asString(enquiry.sender_other_mobiles) || undefined,
  );
  const email = asString(enquiry.sender_email) || null;
  const company =
    asString(enquiry.sender_co) || asString(enquiry.sender_company) || null;
  const product = asString(enquiry.product_name) || null;
  const city = asString(enquiry.sender_city) || null;
  const state = asString(enquiry.sender_state) || null;
  const country = asString(enquiry.sender_country) || null;
  const location = [city, state, country].filter(Boolean).join(", ") || null;
  const typeLabel = inquiryTypeLabel(asString(enquiry.inquiry_type) || undefined);
  const quantity = asString(enquiry.quantity) || null;
  const subject = asString(enquiry.subject) || product || "TradeIndia enquiry";
  const rawMessage =
    asString(enquiry.message) ||
    asString(enquiry.inquiry_message) ||
    [subject, product ? `Product: ${product}` : null, location ? `Location: ${location}` : null]
      .filter(Boolean)
      .join("\n");
  const message = stripHtml(rawMessage);
  const requirement = [product || subject, quantity ? `Qty: ${quantity}` : null]
    .filter(Boolean)
    .join(" · ");
  const now = new Date().toISOString();
  const channelId = await getTradeIndiaChannelId(supabase);
  const isBuy = (enquiry.inquiry_type || "").toUpperCase() === "BUY";

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .insert({
      org_id: await resolveServiceOrgId(),
      external_ref: `TI-${queryId.slice(-8)}`,
      score: isBuy ? 72 : 65,
      status: "New",
      priority: "High",
      source: "tradeindia",
      name,
      company,
      phone,
      email,
      product_label: product,
      requirement,
      location,
      last_activity_at: now,
      next_follow_up_at: now,
      notes: message.slice(0, 2000) || null,
      tags: ["TradeIndia", typeLabel, "Remarketing"],
      metadata: {
        tradeindia_rfi_id: queryId,
        sender_uid: enquiry.sender_uid ?? null,
        inquiry_type: enquiry.inquiry_type || null,
        inquiry_type_label: typeLabel,
        ti_source: enquiry.source || null,
        quantity,
        city,
        state,
        country,
        subject,
        generated_date: asString(enquiry.generated_date || enquiry.inquiry_date) || null,
        generated_time: asString(enquiry.generated_time) || null,
        view_status: asString(enquiry.view_status) || null,
        remarketing: true,
        raw: enquiry,
      },
    })
    .select("id")
    .single();

  if (leadError) throw new Error(leadError.message);

  let customerId: string | null = null;
  if (email || phone) {
    let existingCustomer = null as { id: string } | null;
    if (email) {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("org_id", await resolveServiceOrgId())
        .eq("email", email)
        .maybeSingle();
      existingCustomer = data as { id: string } | null;
    }
    if (!existingCustomer && phone) {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("org_id", await resolveServiceOrgId())
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
          org_id: await resolveServiceOrgId(),
          name,
          email,
          phone,
          company,
          metadata: { city, state, tradeindia: true, source: "tradeindia" },
        })
        .select("id")
        .single();
      customerId = (createdCust?.id as string) || null;
    }
    if (customerId) {
      await supabase.from("leads").update({ customer_id: customerId }).eq("id", lead.id);
    }
  }

  const sessionKey = `ti:${queryId}`;
  const { data: convo, error: convoError } = await supabase
    .from("conversations")
    .insert({
      org_id: await resolveServiceOrgId(),
      customer_id: customerId,
      lead_id: lead.id,
      channel_id: channelId || null,
      channel: "tradeindia",
      external_ref: `TI-${queryId.slice(-6)}`,
      subject: `TradeIndia · ${typeLabel}: ${subject}`.slice(0, 200),
      preview: message.slice(0, 180),
      status: "human",
      assignee_label: "TradeIndia · Follow-up",
      visitor_name: name,
      visitor_email: email,
      visitor_phone: phone,
      visitor_company: company,
      widget_session_id: sessionKey,
      tags: ["TradeIndia", typeLabel, "Remarketing"],
      unread_count: 1,
      metadata: {
        tradeindia_rfi_id: queryId,
        inquiry_type: enquiry.inquiry_type || null,
        city,
        remarketing: true,
      },
    })
    .select("id")
    .single();

  if (convoError) throw new Error(convoError.message);

  await supabase.from("messages").insert({
    org_id: await resolveServiceOrgId(),
    conversation_id: convo.id,
    sender: "customer",
    body: message.slice(0, 8000) || subject,
    metadata: {
      tradeindia_rfi_id: queryId,
      inquiry_type: enquiry.inquiry_type || null,
      generated_date: asString(enquiry.generated_date || enquiry.inquiry_date) || null,
      generated_time: asString(enquiry.generated_time) || null,
    },
  });

  try {
    const { fireAutomations } = await import("@/server/automation-engine");
    fireAutomations("tradeindia_lead", {
      leadId: lead.id as string,
      conversationId: convo.id as string,
      source: "tradeindia",
    });
    fireAutomations("lead_created", {
      leadId: lead.id as string,
      conversationId: convo.id as string,
      source: "tradeindia",
    });
  } catch (err) {
    console.error("TradeIndia automation fire failed", err);
  }

  return {
    created: true,
    skipped: false,
    leadId: lead.id as string,
    conversationId: convo.id as string,
  };
}

export async function syncTradeIndiaWindow(options?: { hours?: number }): Promise<{
  fetched: number;
  created: number;
  skipped: number;
  errors: string[];
}> {
  const cfg = await loadTradeIndiaConfig();
  if (!tradeIndiaConfigReady(cfg) || !cfg.userid || !cfg.profile_id || !cfg.key) {
    throw new Error("TradeIndia userid, profile_id, and key are required");
  }

  // TradeIndia Inquiry API rejects windows > 24 hours
  const hours = Math.min(Math.max(options?.hours ?? 24, 1), 24);
  const end = new Date();
  const maxStart = new Date(end.getTime() - hours * 60 * 60 * 1000);
  let start = cfg.last_sync_at ? new Date(cfg.last_sync_at) : maxStart;
  if (start < maxStart) start = maxStart;
  if (start > end) start = maxStart;

  const enquiries = await pullTradeIndiaEnquiries({
    userid: cfg.userid,
    profileId: cfg.profile_id,
    key: cfg.key,
    from: start,
    to: end,
  });

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const enquiry of enquiries) {
    try {
      const result = await ingestTradeIndiaEnquiry(enquiry);
      if (result.created) created += 1;
      else skipped += 1;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "ingest failed");
    }
  }

  const supabase = createServiceSupabase();
  const nextConfig: TradeIndiaChannelConfig = {
    ...cfg,
    last_sync_at: end.toISOString(),
    last_api_hit_at: new Date().toISOString(),
    backfill: cfg.backfill,
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
    .eq("org_id", await resolveServiceOrgId())
    .eq("type", "tradeindia");

  return { fetched: enquiries.length, created, skipped, errors };
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseTradeIndiaInputDate(value: string, endOf: boolean): Date {
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00`);
    if (!Number.isFinite(d.getTime())) throw new Error(`Invalid date: ${value}`);
    return endOf ? endOfDay(d) : startOfDay(d);
  }
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

/** One calendar day per chunk (from_date === to_date) — stays within TradeIndia's 24h window. */
export function buildTradeIndiaDayChunks(from: Date, to: Date): Array<{ day: Date }> {
  if (from.getTime() > to.getTime()) throw new Error("From date must be before To date");
  const chunks: Array<{ day: Date }> = [];
  let cursor = startOfDay(from);
  const last = startOfDay(to);
  while (cursor.getTime() <= last.getTime()) {
    chunks.push({ day: new Date(cursor) });
    cursor = new Date(cursor.getTime() + TRADEINDIA_DAY_MS);
  }
  return chunks;
}

async function saveTradeIndiaConfig(config: TradeIndiaChannelConfig, detail?: string) {
  const supabase = createServiceSupabase();
  const patch: Record<string, unknown> = { config };
  if (detail) patch.detail = detail;
  await supabase.from("channels").update(patch).eq("org_id", await resolveServiceOrgId()).eq("type", "tradeindia");
}

function tradeIndiaCooldownRemainingMs(cfg: TradeIndiaChannelConfig): number {
  const hit = cfg.last_api_hit_at;
  if (!hit) return 0;
  const elapsed = Date.now() - new Date(hit).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return Math.max(0, TRADEINDIA_PULL_COOLDOWN_MS - elapsed);
}

async function stampTradeIndiaApiHit(cfg: TradeIndiaChannelConfig) {
  const hitAt = new Date().toISOString();
  await saveTradeIndiaConfig({ ...cfg, last_api_hit_at: hitAt });
  return hitAt;
}

/**
 * Pull one calendar day (from_date = to_date). Respects polite cooldown between hits.
 */
export async function syncTradeIndiaExactDay(options: {
  day: Date;
  updateLastSync?: boolean;
}): Promise<{ fetched: number; created: number; skipped: number; errors: string[] }> {
  const cfg = await loadTradeIndiaConfig();
  if (!tradeIndiaConfigReady(cfg) || !cfg.userid || !cfg.profile_id || !cfg.key) {
    throw new Error("TradeIndia userid, profile_id, and key are required");
  }

  const waitMs = tradeIndiaCooldownRemainingMs(cfg);
  if (waitMs > 0) {
    const secs = Math.ceil(waitMs / 1000);
    throw new Error(`TradeIndia pull cooldown: wait about ${secs}s before the next day chunk.`);
  }

  const day = startOfDay(options.day);
  const hitAt = await stampTradeIndiaApiHit(cfg);
  const cfgWithHit: TradeIndiaChannelConfig = { ...cfg, last_api_hit_at: hitAt };

  const enquiries = await pullTradeIndiaEnquiries({
    userid: cfg.userid,
    profileId: cfg.profile_id,
    key: cfg.key,
    from: day,
    to: day,
  });

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const enquiry of enquiries) {
    try {
      const result = await ingestTradeIndiaEnquiry(enquiry);
      if (result.created) created += 1;
      else skipped += 1;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "ingest failed");
    }
  }

  const nextConfig: TradeIndiaChannelConfig = {
    ...cfgWithHit,
    last_api_hit_at: hitAt,
    last_sync_at:
      options.updateLastSync === false ? cfg.last_sync_at : endOfDay(day).toISOString(),
    backfill: cfg.backfill,
  };
  await saveTradeIndiaConfig(
    nextConfig,
    `Last sync ${formatTradeIndiaDate(day)} · +${created} leads`,
  );

  return { fetched: enquiries.length, created, skipped, errors };
}

export async function startTradeIndiaBackfill(options: {
  from: string;
  to: string;
}): Promise<{
  ok: boolean;
  chunksTotal: number;
  message: string;
  backfill: TradeIndiaBackfillState;
}> {
  const cfg = await loadTradeIndiaConfig();
  if (!tradeIndiaConfigReady(cfg)) {
    throw new Error("TradeIndia credentials are not configured");
  }
  if (cfg.backfill?.status === "running" || cfg.backfill?.status === "waiting") {
    throw new Error("A backfill is already in progress — wait for it to finish or cancel it");
  }

  const now = Date.now();
  const earliest = new Date(now - TRADEINDIA_MAX_LOOKBACK_MS);
  let from = parseTradeIndiaInputDate(options.from, false);
  let to = parseTradeIndiaInputDate(options.to, true);
  if (to.getTime() > now) to = new Date(now);
  if (from.getTime() < earliest.getTime()) from = earliest;
  if (from.getTime() > to.getTime()) {
    throw new Error("From date must be on or before To date (within last 365 days)");
  }

  const chunks = buildTradeIndiaDayChunks(from, to);
  if (chunks.length === 0) throw new Error("No date range to pull");

  const backfill: TradeIndiaBackfillState = {
    status: "running",
    from: startOfDay(from).toISOString(),
    to: endOfDay(to).toISOString(),
    cursor: chunks[0].day.toISOString(),
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

  await saveTradeIndiaConfig(
    { ...cfg, backfill },
    `TradeIndia backfill started · ${chunks.length} day(s)`,
  );

  const tick = await tickTradeIndiaBackfill();
  return {
    ok: true,
    chunksTotal: chunks.length,
    message: tick.processed
      ? `Backfill started — day 1/${chunks.length} done. Remaining days run about every minute.`
      : `Backfill queued — ${chunks.length} day(s). ${tick.message}`,
    backfill: tick.backfill || backfill,
  };
}

/**
 * Advance backfill by one calendar day when cooldown allows.
 * Safe to call from UI poll or cron.
 */
export async function tickTradeIndiaBackfill(): Promise<{
  processed: boolean;
  waiting: boolean;
  done: boolean;
  message: string;
  backfill: TradeIndiaBackfillState | null;
  cooldownMs: number;
}> {
  const cfg = await loadTradeIndiaConfig();
  const bf = cfg.backfill;
  if (!bf || (bf.status !== "running" && bf.status !== "waiting")) {
    return {
      processed: false,
      waiting: false,
      done: bf?.status === "done",
      message: "No active backfill",
      backfill: bf || null,
      cooldownMs: tradeIndiaCooldownRemainingMs(cfg),
    };
  }

  const cooldownMs = tradeIndiaCooldownRemainingMs(cfg);
  if (cooldownMs > 0) {
    const next = new Date(Date.now() + cooldownMs).toISOString();
    const waiting: TradeIndiaBackfillState = {
      ...bf,
      status: "waiting",
      nextChunkAt: next,
      updatedAt: new Date().toISOString(),
    };
    await saveTradeIndiaConfig({ ...cfg, backfill: waiting });
    return {
      processed: false,
      waiting: true,
      done: false,
      message: `Waiting ${Math.ceil(cooldownMs / 1000)}s before next day`,
      backfill: waiting,
      cooldownMs,
    };
  }

  const from = new Date(bf.from);
  const to = new Date(bf.to);
  const chunks = buildTradeIndiaDayChunks(from, to);
  const idx = Math.min(bf.chunksDone, chunks.length);
  if (idx >= chunks.length) {
    const done: TradeIndiaBackfillState = {
      ...bf,
      status: "done",
      nextChunkAt: null,
      updatedAt: new Date().toISOString(),
    };
    await saveTradeIndiaConfig(
      { ...cfg, backfill: done },
      `TradeIndia backfill complete · +${done.created} leads`,
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
    const result = await syncTradeIndiaExactDay({
      day: chunk.day,
      updateLastSync: true,
    });

    const cfgAfter = await loadTradeIndiaConfig();
    const nextDone = idx + 1;
    const finished = nextDone >= chunks.length;
    const nextBf: TradeIndiaBackfillState = {
      ...bf,
      status: finished ? "done" : "waiting",
      chunksDone: nextDone,
      cursor: finished ? bf.to : chunks[nextDone].day.toISOString(),
      fetched: bf.fetched + result.fetched,
      created: bf.created + result.created,
      skipped: bf.skipped + result.skipped,
      errors: [...bf.errors, ...result.errors].slice(-20),
      lastError: null,
      updatedAt: new Date().toISOString(),
      nextChunkAt: finished
        ? null
        : new Date(Date.now() + TRADEINDIA_PULL_COOLDOWN_MS).toISOString(),
    };

    await saveTradeIndiaConfig(
      { ...cfgAfter, backfill: nextBf },
      finished
        ? `TradeIndia backfill complete · +${nextBf.created} leads`
        : `TradeIndia backfill ${nextDone}/${chunks.length} · +${nextBf.created} leads so far`,
    );

    return {
      processed: true,
      waiting: !finished,
      done: finished,
      message: finished
        ? `Backfill complete · ${nextBf.created} new leads`
        : `Day ${nextDone}/${chunks.length} (${formatTradeIndiaDate(chunk.day)}) done · next in ~1 min`,
      backfill: nextBf,
      cooldownMs: TRADEINDIA_PULL_COOLDOWN_MS,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "day chunk failed";
    const isCooldown = /cooldown/i.test(msg);
    const errBf: TradeIndiaBackfillState = {
      ...bf,
      status: isCooldown ? "waiting" : "error",
      lastError: msg,
      errors: [...bf.errors, msg].slice(-20),
      updatedAt: new Date().toISOString(),
      nextChunkAt: isCooldown
        ? new Date(Date.now() + tradeIndiaCooldownRemainingMs(cfg)).toISOString()
        : bf.nextChunkAt,
    };
    await saveTradeIndiaConfig({ ...cfg, backfill: errBf });
    return {
      processed: false,
      waiting: errBf.status === "waiting",
      done: false,
      message: msg,
      backfill: errBf,
      cooldownMs: tradeIndiaCooldownRemainingMs(await loadTradeIndiaConfig()),
    };
  }
}

export async function cancelTradeIndiaBackfill(): Promise<TradeIndiaBackfillState | null> {
  const cfg = await loadTradeIndiaConfig();
  if (!cfg.backfill) return null;
  const cancelled: TradeIndiaBackfillState = {
    ...cfg.backfill,
    status: "cancelled",
    nextChunkAt: null,
    updatedAt: new Date().toISOString(),
  };
  await saveTradeIndiaConfig(
    { ...cfg, backfill: cancelled },
    `TradeIndia backfill cancelled · ${cancelled.chunksDone}/${cancelled.chunksTotal} days done`,
  );
  return cancelled;
}

export async function ensureTradeIndiaChannelRow(): Promise<{
  ok: boolean;
  created: boolean;
  channelId?: string;
  error?: string;
}> {
  const supabase = createServiceSupabase();
  const { data: existing } = await supabase
    .from("channels")
    .select("id")
    .eq("org_id", await resolveServiceOrgId())
    .eq("type", "tradeindia")
    .maybeSingle();

  if (existing?.id) {
    return { ok: true, created: false, channelId: existing.id as string };
  }

  const { data: inserted, error } = await supabase
    .from("channels")
    .insert({
      org_id: await resolveServiceOrgId(),
      type: "tradeindia",
      name: "TradeIndia",
      status: "Disconnected",
      health: 0,
      detail: "Inquiry API (My Inquiry API)",
      is_enabled: false,
      config: {},
    })
    .select("id")
    .single();

  if (error) {
    const msg = error.message || "Could not create TradeIndia channel";
    if (/tradeindia|invalid input value for enum/i.test(msg)) {
      return {
        ok: false,
        created: false,
        error:
          "Run supabase/migrations/014_tradeindia_channel.sql then 014b in Supabase SQL Editor, then refresh.",
      };
    }
    return { ok: false, created: false, error: msg };
  }

  return { ok: true, created: true, channelId: inserted?.id as string };
}

export const ensureTradeIndiaChannel = createServerFn({ method: "POST" }).handler(async () => {
  return ensureTradeIndiaChannelRow();
});

export const saveTradeIndiaChannelConfig = createServerFn({ method: "POST" })
  .validator(
    z.object({
      userid: z.string().min(1).max(64),
      profileId: z.string().min(1).max(64),
      key: z.string().min(8).max(500),
      enable: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const ensured = await ensureTradeIndiaChannelRow();
    if (!ensured.ok) {
      throw new Error(ensured.error || "TradeIndia channel missing — run migration 014");
    }

    const prev = await loadTradeIndiaConfig();
    const config: TradeIndiaChannelConfig = {
      userid: data.userid.trim(),
      profile_id: data.profileId.trim(),
      key: data.key.trim(),
      last_sync_at: prev.last_sync_at,
      last_api_hit_at: prev.last_api_hit_at,
      backfill: prev.backfill,
      auto_sync_enabled: prev.auto_sync_enabled,
      auto_sync_schedule: prev.auto_sync_schedule,
      auto_sync_daily_time: prev.auto_sync_daily_time,
      last_auto_sync_at: prev.last_auto_sync_at,
    };

    const supabase = createServiceSupabase();
    const enable = data.enable !== false;
    const { error } = await supabase
      .from("channels")
      .update({
        config,
        detail: "TradeIndia Inquiry API",
        status: enable ? "Connected" : "Disconnected",
        is_enabled: enable,
        health: enable ? 100 : 0,
        name: "TradeIndia",
      })
      .eq("org_id", await resolveServiceOrgId())
      .eq("type", "tradeindia");

    if (error) throw new Error(error.message);
    return { ok: true, configured: true };
  });

export const getTradeIndiaSetup = createServerFn({ method: "GET" }).handler(async () => {
  let cfg = await loadTradeIndiaConfig();

  if (cfg.backfill && (cfg.backfill.status === "running" || cfg.backfill.status === "waiting")) {
    if (tradeIndiaCooldownRemainingMs(cfg) === 0) {
      await tickTradeIndiaBackfill();
      cfg = await loadTradeIndiaConfig();
    }
  }

  const supabase = createServiceSupabase();
  const { data: row } = await supabase
    .from("channels")
    .select("id, is_enabled, status, detail, config")
    .eq("org_id", await resolveServiceOrgId())
    .eq("type", "tradeindia")
    .maybeSingle();

  const stored = ((row?.config as TradeIndiaChannelConfig) || {}) as TradeIndiaChannelConfig;
  const cooldownMs = tradeIndiaCooldownRemainingMs(cfg);
  const earliest = new Date(Date.now() - TRADEINDIA_MAX_LOOKBACK_MS).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  return {
    configured: tradeIndiaConfigReady(cfg),
    channelReady: Boolean(row?.id),
    channelCreated: Boolean(row?.id),
    enabled: Boolean(row?.is_enabled),
    status: row?.status || null,
    detail: row?.detail || null,
    lastSyncAt: cfg.last_sync_at || null,
    lastApiHitAt: cfg.last_api_hit_at || null,
    cooldownMs,
    hasKey: Boolean(cfg.key),
    userid: stored.userid || cfg.userid || "",
    profileId: stored.profile_id || cfg.profile_id || "",
    pullDocs: "https://www.tradeindia.com/utils/my_inquiry.html",
    backfill: cfg.backfill || null,
    backfillEarliestDate: earliest,
    backfillLatestDate: today,
    autoSyncEnabled: Boolean(cfg.auto_sync_enabled),
    autoSyncSchedule: (cfg.auto_sync_schedule || "every_6h") as AutoSyncSchedule,
    autoSyncDailyTime: normalizeDailyTime(cfg.auto_sync_daily_time),
    lastAutoSyncAt: cfg.last_auto_sync_at || null,
  };
});

export const saveTradeIndiaAutoSync = createServerFn({ method: "POST" })
  .validator(
    z.object({
      enabled: z.boolean(),
      schedule: z.enum(["hourly", "every_6h", "daily_at"]).optional(),
      dailyTime: z.string().max(8).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const cfg = await loadTradeIndiaConfig();
    if (!tradeIndiaConfigReady(cfg)) {
      throw new Error("Configure TradeIndia credentials before enabling auto sync");
    }
    const next: TradeIndiaChannelConfig = {
      ...cfg,
      auto_sync_enabled: data.enabled,
      auto_sync_schedule: data.schedule || cfg.auto_sync_schedule || "every_6h",
      auto_sync_daily_time: normalizeDailyTime(data.dailyTime ?? cfg.auto_sync_daily_time),
    };
    await saveTradeIndiaConfig(
      next,
      data.enabled
        ? `TradeIndia auto sync on (${next.auto_sync_schedule})`
        : "TradeIndia auto sync off — manual Sync only",
    );
    return {
      ok: true,
      autoSyncEnabled: Boolean(next.auto_sync_enabled),
      autoSyncSchedule: next.auto_sync_schedule,
      autoSyncDailyTime: next.auto_sync_daily_time,
      lastAutoSyncAt: next.last_auto_sync_at || null,
    };
  });

/** Cron: if auto sync enabled and due, pull last 24h window. */
export async function tickTradeIndiaAutoSync(): Promise<{
  ran: boolean;
  skipped?: string;
  created?: number;
  fetched?: number;
}> {
  const cfg = await loadTradeIndiaConfig();
  if (!tradeIndiaConfigReady(cfg)) return { ran: false, skipped: "not_configured" };
  if (!isAutoSyncDue(cfg)) return { ran: false, skipped: "not_due" };
  if (cfg.backfill?.status === "running" || cfg.backfill?.status === "waiting") {
    return { ran: false, skipped: "backfill_active" };
  }
  if (tradeIndiaCooldownRemainingMs(cfg) > 0) {
    return { ran: false, skipped: "cooldown" };
  }

  try {
    const result = await syncTradeIndiaWindow({ hours: 24 });
    const latest = await loadTradeIndiaConfig();
    await saveTradeIndiaConfig({
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

export const syncTradeIndiaLeads = createServerFn({ method: "POST" })
  .validator(z.object({ hours: z.number().int().min(1).max(24).optional() }).optional())
  .handler(async ({ data }) => {
    return syncTradeIndiaWindow({ hours: data?.hours });
  });

export const startTradeIndiaBackfillFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      from: z.string().min(8).max(40),
      to: z.string().min(8).max(40),
    }),
  )
  .handler(async ({ data }) => {
    return startTradeIndiaBackfill({ from: data.from, to: data.to });
  });

export const tickTradeIndiaBackfillFn = createServerFn({ method: "POST" }).handler(async () => {
  return tickTradeIndiaBackfill();
});

export const cancelTradeIndiaBackfillFn = createServerFn({ method: "POST" }).handler(async () => {
  return cancelTradeIndiaBackfill();
});
