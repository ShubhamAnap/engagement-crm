/**
 * Brainmine CRM+ — read-only lead sync into master `/leads`.
 *
 * Flexible connector (Brainmine deployments vary; often ERPNext/Frappe-style):
 * - Configure API base URL + API key (+ optional secret)
 * - Auth: bearer | token (key:secret) | x-api-key | query
 * - Default endpoint: /api/resource/Lead (ERPNext); override with leads_path
 * - Field map stored in channel config; defaults match ERPNext Lead
 *
 * Replace defaults when official Brainmine API docs arrive.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import type { LeadStatus } from "@/lib/db-types";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

export type BrainmineAuthStyle = "bearer" | "token" | "x-api-key" | "query";

export type BrainmineFieldMap = {
  id?: string;
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  location?: string;
  requirement?: string;
  sales_person?: string;
  status?: string;
  notes?: string;
  tags?: string;
};

export type BrainmineIntervalUnit = "sec" | "min" | "hr";

export type BrainmineChannelConfig = {
  api_base_url?: string;
  api_key?: string;
  /** Used with auth_style=token as api_key:api_secret (ERPNext style) */
  api_secret?: string;
  auth_style?: BrainmineAuthStyle;
  /** Relative path under base, e.g. /api/resource/Lead */
  leads_path?: string;
  /** Query param name when auth_style=query */
  query_key_param?: string;
  field_map?: BrainmineFieldMap;
  last_sync_at?: string;
  /** Optional JSON-path-ish list key: data | data.message | leads | results */
  list_key?: string;
  /** Max leads pulled per date-range page (ERPNext limit_page_length). Default 30. */
  sync_limit?: number;
  /** Auto-fetch latest updated leads (≤20), upsert — not historical backfill */
  auto_sync_enabled?: boolean;
  auto_sync_interval_value?: number;
  auto_sync_interval_unit?: BrainmineIntervalUnit;
  last_auto_sync_at?: string;
};

const DEFAULT_SYNC_LIMIT = 30;
const MAX_SYNC_LIMIT = 200;
/** Quick "Sync leads now" — latest recently-updated only (not historical backfill). */
const QUICK_SYNC_LIMIT = 20;

function clampSyncLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SYNC_LIMIT;
  return Math.min(MAX_SYNC_LIMIT, Math.floor(n));
}

/** Normalize custom interval. Floor 60s (cron is ~1–5 min). Cap 7 days. */
export function normalizeBrainmineInterval(
  value?: number | null,
  unit?: string | null,
): { value: number; unit: BrainmineIntervalUnit } {
  const u: BrainmineIntervalUnit =
    unit === "sec" || unit === "min" || unit === "hr" ? unit : "hr";
  let v = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(v) || v < 1) v = u === "hr" ? 1 : u === "min" ? 30 : 60;
  v = Math.floor(v);
  if (u === "sec") {
    v = Math.max(60, Math.min(v, 7 * 24 * 3600));
  } else if (u === "min") {
    v = Math.max(1, Math.min(v, 7 * 24 * 60));
  } else {
    v = Math.max(1, Math.min(v, 7 * 24));
  }
  return { value: v, unit: u };
}

export function brainmineIntervalToMs(value: number, unit: BrainmineIntervalUnit): number {
  const n = normalizeBrainmineInterval(value, unit);
  if (n.unit === "sec") return n.value * 1000;
  if (n.unit === "min") return n.value * 60_000;
  return n.value * 3_600_000;
}

export function describeBrainmineAutoSync(cfg: BrainmineChannelConfig): string {
  if (!cfg.auto_sync_enabled) return "Auto sync off — use Sync leads now";
  const { value, unit } = normalizeBrainmineInterval(
    cfg.auto_sync_interval_value,
    cfg.auto_sync_interval_unit,
  );
  const unitLabel = unit === "sec" ? "sec" : unit === "min" ? "min" : "hr";
  return `Auto sync every ${value} ${unitLabel} (latest ≤${QUICK_SYNC_LIMIT} leads)`;
}

export function isBrainmineAutoSyncDue(cfg: BrainmineChannelConfig, now = new Date()): boolean {
  if (!cfg.auto_sync_enabled) return false;
  const { value, unit } = normalizeBrainmineInterval(
    cfg.auto_sync_interval_value,
    cfg.auto_sync_interval_unit,
  );
  const needMs = brainmineIntervalToMs(value, unit);
  const lastMs = cfg.last_auto_sync_at ? new Date(cfg.last_auto_sync_at).getTime() : 0;
  const elapsed = now.getTime() - (Number.isFinite(lastMs) ? lastMs : 0);
  const slackMs = Math.min(45_000, Math.floor(needMs * 0.05));
  return elapsed >= needMs - slackMs;
}

async function persistBrainmineConfig(
  next: BrainmineChannelConfig,
  detail?: string,
): Promise<void> {
  const supabase = createServiceSupabase();
  await supabase
    .from("channels")
    .update({
      config: next,
      ...(detail ? { detail } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ORG_ID)
    .eq("type", "brainmine");
}

const DEFAULT_FIELD_MAP: Required<BrainmineFieldMap> = {
  id: "name",
  name: "lead_name",
  company: "company_name",
  email: "email_id",
  phone: "mobile_no",
  location: "city",
  requirement: "notes",
  sales_person: "owner",
  status: "status",
  notes: "notes",
  tags: "source",
};

function envConfig(): BrainmineChannelConfig {
  return {
    api_base_url: process.env.BRAINMINE_API_BASE_URL || undefined,
    api_key: process.env.BRAINMINE_API_KEY || undefined,
    api_secret: process.env.BRAINMINE_API_SECRET || undefined,
    auth_style: (process.env.BRAINMINE_AUTH_STYLE as BrainmineAuthStyle) || "token",
    leads_path: process.env.BRAINMINE_LEADS_PATH || "/api/resource/Lead",
    sync_limit: process.env.BRAINMINE_SYNC_LIMIT
      ? clampSyncLimit(process.env.BRAINMINE_SYNC_LIMIT)
      : undefined,
  };
}

export async function loadBrainmineConfig(): Promise<BrainmineChannelConfig> {
  const fromEnv = envConfig();
  try {
    const supabase = createServiceSupabase();
    const { data } = await supabase
      .from("channels")
      .select("config, detail")
      .eq("org_id", ORG_ID)
      .eq("type", "brainmine")
      .maybeSingle();
    const cfg = ((data?.config as BrainmineChannelConfig) || {}) as BrainmineChannelConfig;
    // UI/channel config overrides env when both are set.
    return {
      api_base_url: cfg.api_base_url || fromEnv.api_base_url,
      api_key: cfg.api_key || fromEnv.api_key,
      api_secret: cfg.api_secret || fromEnv.api_secret,
      auth_style: cfg.auth_style || fromEnv.auth_style || "token",
      leads_path: cfg.leads_path || fromEnv.leads_path || "/api/resource/Lead",
      query_key_param: cfg.query_key_param || "api_key",
      field_map: { ...DEFAULT_FIELD_MAP, ...(cfg.field_map || {}) },
      last_sync_at: cfg.last_sync_at,
      list_key: cfg.list_key || "data",
      sync_limit: clampSyncLimit(
        cfg.sync_limit ?? fromEnv.sync_limit ?? DEFAULT_SYNC_LIMIT,
      ),
      auto_sync_enabled: Boolean(cfg.auto_sync_enabled),
      auto_sync_interval_value: normalizeBrainmineInterval(
        cfg.auto_sync_interval_value,
        cfg.auto_sync_interval_unit,
      ).value,
      auto_sync_interval_unit: normalizeBrainmineInterval(
        cfg.auto_sync_interval_value,
        cfg.auto_sync_interval_unit,
      ).unit,
      last_auto_sync_at: cfg.last_auto_sync_at,
    };
  } catch {
    return {
      ...fromEnv,
      field_map: DEFAULT_FIELD_MAP,
      list_key: "data",
      leads_path: fromEnv.leads_path || "/api/resource/Lead",
      auth_style: fromEnv.auth_style || "token",
      sync_limit: clampSyncLimit(fromEnv.sync_limit ?? DEFAULT_SYNC_LIMIT),
      auto_sync_enabled: false,
      auto_sync_interval_value: 1,
      auto_sync_interval_unit: "hr",
    };
  }
}

export function brainmineConfigReady(cfg: BrainmineChannelConfig): boolean {
  return Boolean(cfg.api_base_url?.trim() && cfg.api_key?.trim());
}

function getByPath(obj: unknown, path: string | undefined): unknown {
  if (!path || obj == null) return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function cleanPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

function mapBrainmineStatus(raw: string | null): LeadStatus {
  const s = (raw || "").toLowerCase();
  if (!s) return "New";
  if (/won|converted|customer|do not contact/.test(s)) return "Won";
  if (/lost|junk|unqualified|not interested/.test(s)) return "Lost";
  if (/negotiat/.test(s)) return "Negotiation";
  if (/proposal|quotat/.test(s)) return "Proposal";
  if (/qualif|opportunit|interested/.test(s)) return "Qualified";
  if (/contact|replied|open|working|follow/.test(s)) return "Contacted";
  if (/lead|new/.test(s)) return "New";
  return "New";
}

function extractList(json: unknown, listKey: string): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  const nested = getByPath(json, listKey);
  if (Array.isArray(nested)) return nested as Record<string, unknown>[];
  // ERPNext sometimes: { data: [ ... ] } already handled; also message
  const msg = getByPath(json, "message");
  if (Array.isArray(msg)) return msg as Record<string, unknown>[];
  const data = getByPath(json, "data");
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: Record<string, unknown>[] }).data;
  }
  return [];
}

function buildAuthHeaders(cfg: BrainmineChannelConfig): Record<string, string> {
  const key = cfg.api_key!.trim();
  const secret = cfg.api_secret?.trim();
  const style = cfg.auth_style || "token";
  if (style === "bearer") {
    return { Authorization: `Bearer ${key}` };
  }
  if (style === "token") {
    // ERPNext: token api_key:api_secret
    const token = secret ? `${key}:${secret}` : key;
    return { Authorization: `token ${token}` };
  }
  if (style === "x-api-key") {
    return { "X-API-Key": key };
  }
  return {};
}

export async function fetchBrainmineLeads(
  cfg: BrainmineChannelConfig,
  options?: {
    /** YYYY-MM-DD inclusive start (filters on creation) */
    from?: string;
    /** YYYY-MM-DD inclusive end */
    to?: string;
    /** ERPNext pagination offset */
    limitStart?: number;
    /** Override page size (default: channel sync_limit) */
    pageSize?: number;
    /** ERPNext order_by, e.g. "modified desc" */
    orderBy?: string;
    /** When true, skip last_sync_at incremental filter */
    forceFullPage?: boolean;
    /** Use modified >= last_sync (quick sync). Ignored when from/to set. */
    incrementalOnly?: boolean;
  },
): Promise<Record<string, unknown>[]> {
  if (!brainmineConfigReady(cfg)) {
    throw new Error("Brainmine API base URL and API key are required");
  }
  const base = cfg.api_base_url!.replace(/\/$/, "");
  const path = (cfg.leads_path || "/api/resource/Lead").startsWith("/")
    ? cfg.leads_path || "/api/resource/Lead"
    : `/${cfg.leads_path}`;
  const url = new URL(`${base}${path}`);
  const pageSize = clampSyncLimit(
    options?.pageSize ?? cfg.sync_limit ?? DEFAULT_SYNC_LIMIT,
  );

  url.searchParams.set("limit_page_length", String(pageSize));
  if (options?.limitStart && options.limitStart > 0) {
    url.searchParams.set("limit_start", String(options.limitStart));
  }
  url.searchParams.set(
    "order_by",
    options?.orderBy || (options?.from || options?.to ? "creation desc" : "modified desc"),
  );

  // Prefer Lead field list; Opportunity / other doctypes still get creation/modified via filters.
  if (!url.searchParams.has("fields") && /\/(Lead|Opportunity)/i.test(path)) {
    const isOpp = /Opportunity/i.test(path);
    url.searchParams.set(
      "fields",
      JSON.stringify(
        isOpp
          ? [
              "name",
              "party_name",
              "customer_name",
              "contact_email",
              "contact_mobile",
              "city",
              "status",
              "source",
              "notes",
              "owner",
              "modified",
              "creation",
            ]
          : [
              "name",
              "lead_name",
              "company_name",
              "email_id",
              "mobile_no",
              "city",
              "status",
              "source",
              "notes",
              "owner",
              "modified",
              "creation",
            ],
      ),
    );
  }

  const filters: unknown[] = [];
  if (options?.from || options?.to) {
    if (options.from) {
      filters.push(["creation", ">=", `${options.from} 00:00:00`]);
    }
    if (options.to) {
      filters.push(["creation", "<=", `${options.to} 23:59:59`]);
    }
  } else if (
    options?.incrementalOnly !== false &&
    !options?.forceFullPage &&
    cfg.last_sync_at
  ) {
    filters.push([
      "modified",
      ">=",
      cfg.last_sync_at.replace("T", " ").slice(0, 19),
    ]);
  }
  if (filters.length) {
    url.searchParams.set("filters", JSON.stringify(filters));
  }

  if (cfg.auth_style === "query") {
    url.searchParams.set(cfg.query_key_param || "api_key", cfg.api_key!);
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...buildAuthHeaders(cfg),
  };

  const res = await fetch(url.toString(), { method: "GET", headers });
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Brainmine returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const errMsg =
      asString(getByPath(json, "message")) ||
      asString(getByPath(json, "error")) ||
      asString(getByPath(json, "exc")) ||
      `Brainmine API error (${res.status})`;
    throw new Error(errMsg);
  }
  return extractList(json, cfg.list_key || "data");
}

const MAX_DATE_RANGE_PAGES = 50;

function parseYmd(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function syncBrainmineWindow(options?: {
  from?: string;
  to?: string;
}): Promise<{
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  lastSyncAt: string;
  from: string | null;
  to: string | null;
  pages: number;
}> {
  const cfg = await loadBrainmineConfig();
  if (!brainmineConfigReady(cfg)) {
    throw new Error("Configure Brainmine API base URL and API key under Channels first.");
  }

  const from = options?.from?.trim() || undefined;
  const to = options?.to?.trim() || undefined;
  const isDateRange = Boolean(from || to);

  if (isDateRange) {
    if (!from || !to) throw new Error("Both From and To dates are required for date-range sync");
    const fromD = parseYmd(from);
    const toD = parseYmd(to);
    if (!fromD || !toD) throw new Error("Dates must be YYYY-MM-DD");
    if (fromD.getTime() > toD.getTime()) throw new Error("From date must be on or before To date");
    const spanDays = Math.ceil((toD.getTime() - fromD.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (spanDays > 366) {
      throw new Error("Date range cannot exceed 365 days — split into smaller ranges");
    }
  }

  const allRows: Record<string, unknown>[] = [];
  let pages = 0;

  if (isDateRange) {
    // Historical backfill — paginate by Configure "Leads per sync"
    const pageSize = clampSyncLimit(cfg.sync_limit ?? DEFAULT_SYNC_LIMIT);
    for (let start = 0; pages < MAX_DATE_RANGE_PAGES; start += pageSize) {
      const batch = await fetchBrainmineLeads(cfg, {
        from,
        to,
        limitStart: start,
        pageSize,
        orderBy: "creation desc",
        forceFullPage: true,
      });
      pages += 1;
      if (!batch.length) break;
      allRows.push(...batch);
      if (batch.length < pageSize) break;
    }
  } else {
    // Quick Sync — only latest recently-updated leads, max 20, single page
    const batch = await fetchBrainmineLeads(cfg, {
      pageSize: QUICK_SYNC_LIMIT,
      orderBy: "modified desc",
      incrementalOnly: true,
    });
    pages = 1;
    allRows.push(...batch.slice(0, QUICK_SYNC_LIMIT));
  }

  // Deduplicate by Brainmine id within this batch (API should not repeat; belt-and-suspenders)
  const seen = new Set<string>();
  const uniqueRows: Record<string, unknown>[] = [];
  for (const row of allRows) {
    const id =
      asString(row.name) ||
      asString(row.id) ||
      asString(row.uuid) ||
      JSON.stringify(row).slice(0, 80);
    if (seen.has(id)) continue;
    seen.add(id);
    uniqueRows.push(row);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of uniqueRows) {
    const result = await ingestBrainmineLead(row, cfg.field_map || DEFAULT_FIELD_MAP);
    if (result.created) created += 1;
    else if (result.updated) updated += 1;
    else skipped += 1;
  }

  const supabase = createServiceSupabase();
  const nextCfg: BrainmineChannelConfig = {
    ...cfg,
    last_sync_at: new Date().toISOString(),
  };
  await supabase
    .from("channels")
    .update({
      config: nextCfg,
      status: "Connected",
      health: 100,
      detail: from && to
        ? `Brainmine · ${cfg.api_base_url} · synced ${from}→${to}`
        : `Brainmine · ${cfg.api_base_url} · quick ≤${QUICK_SYNC_LIMIT}`,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ORG_ID)
    .eq("type", "brainmine");

  return {
    fetched: uniqueRows.length,
    created,
    updated,
    skipped,
    lastSyncAt: nextCfg.last_sync_at!,
    from: from || null,
    to: to || null,
    pages,
  };
}

function mapRow(
  row: Record<string, unknown>,
  fieldMap: BrainmineFieldMap,
): {
  externalId: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  requirement: string | null;
  salesPerson: string | null;
  status: LeadStatus;
  notes: string | null;
  tags: string[];
} {
  const fm = { ...DEFAULT_FIELD_MAP, ...fieldMap };
  const externalId =
    asString(getByPath(row, fm.id)) ||
    asString(row.id) ||
    asString(row.name) ||
    asString(row.uuid) ||
    "";
  const name =
    asString(getByPath(row, fm.name)) ||
    asString(row.lead_name) ||
    asString(row.contact_name) ||
    asString(row.full_name) ||
    "Brainmine lead";
  const company = asString(getByPath(row, fm.company));
  const email = asString(getByPath(row, fm.email));
  const phone = cleanPhone(asString(getByPath(row, fm.phone)));
  const location = asString(getByPath(row, fm.location));
  const requirement = asString(getByPath(row, fm.requirement));
  const salesPerson = asString(getByPath(row, fm.sales_person));
  const status = mapBrainmineStatus(asString(getByPath(row, fm.status)));
  const notes = asString(getByPath(row, fm.notes));
  const tagRaw = asString(getByPath(row, fm.tags));
  const tags = ["brainmine", ...(tagRaw ? [tagRaw] : [])];
  return {
    externalId,
    name,
    company,
    email,
    phone,
    location,
    requirement,
    salesPerson,
    status,
    notes,
    tags,
  };
}

export async function ingestBrainmineLead(
  row: Record<string, unknown>,
  fieldMap: BrainmineFieldMap,
): Promise<{ created: boolean; updated: boolean; skipped: boolean; leadId?: string }> {
  const mapped = mapRow(row, fieldMap);
  if (!mapped.externalId) {
    return { created: false, updated: false, skipped: true };
  }

  const supabase = createServiceSupabase();
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("leads")
    .select("id, notes, tags, requirement, location, sales_person")
    .eq("org_id", ORG_ID)
    .eq("source", "brainmine")
    .filter("metadata->>brainmine_id", "eq", mapped.externalId)
    .limit(1)
    .maybeSingle();

  const payload = {
    name: mapped.name,
    company: mapped.company,
    email: mapped.email,
    phone: mapped.phone,
    location: mapped.location,
    requirement: mapped.requirement,
    product_label: mapped.requirement,
    sales_person: mapped.salesPerson,
    status: mapped.status,
    notes: mapped.notes,
    tags: mapped.tags,
    source: "brainmine" as const,
    last_activity_at: now,
    metadata: {
      brainmine_id: mapped.externalId,
      brainmine: true,
      remarketing: true,
      raw: row,
    },
  };

  if (existing) {
    const { error } = await supabase
      .from("leads")
      .update({
        ...payload,
        // Keep local tags merged
        tags: Array.from(new Set([...(existing.tags || []), ...mapped.tags])),
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return { created: false, updated: true, skipped: false, leadId: existing.id as string };
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      org_id: ORG_ID,
      external_ref: `BM-${mapped.externalId.slice(-8)}`,
      score: 60,
      priority: "Medium",
      next_follow_up_at: now,
      ...payload,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  try {
    const { fireAutomations } = await import("@/server/automation-engine");
    fireAutomations("lead_created", { leadId: lead.id as string });
  } catch (err) {
    console.error("brainmine lead_created automation", err);
  }

  return { created: true, updated: false, skipped: false, leadId: lead.id as string };
}

export const getBrainmineSetup = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = createServiceSupabase();
  const cfg = await loadBrainmineConfig();
  const { data: channel } = await supabase
    .from("channels")
    .select("id, is_enabled, status, config")
    .eq("org_id", ORG_ID)
    .eq("type", "brainmine")
    .maybeSingle();
  return {
    configured: brainmineConfigReady(cfg),
    channelReady: Boolean(channel),
    channelCreated: Boolean(channel),
    lastSyncAt: cfg.last_sync_at || null,
    authStyle: cfg.auth_style || "token",
    leadsPath: cfg.leads_path || "/api/resource/Lead",
    apiBaseUrl: cfg.api_base_url || "",
    syncLimit: clampSyncLimit(cfg.sync_limit ?? DEFAULT_SYNC_LIMIT),
    hasKey: Boolean(cfg.api_key),
    hasSecret: Boolean(cfg.api_secret),
    fromEnv: {
      baseUrl: Boolean(process.env.BRAINMINE_API_BASE_URL?.trim()),
      key: Boolean(process.env.BRAINMINE_API_KEY?.trim()),
      secret: Boolean(process.env.BRAINMINE_API_SECRET?.trim()),
      syncLimit: Boolean(process.env.BRAINMINE_SYNC_LIMIT?.trim()),
    },
    rangeEarliestDate: (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 365);
      return ymdUtc(d);
    })(),
    rangeLatestDate: ymdUtc(new Date()),
    autoSyncEnabled: Boolean(cfg.auto_sync_enabled),
    autoSyncIntervalValue: normalizeBrainmineInterval(
      cfg.auto_sync_interval_value,
      cfg.auto_sync_interval_unit,
    ).value,
    autoSyncIntervalUnit: normalizeBrainmineInterval(
      cfg.auto_sync_interval_value,
      cfg.auto_sync_interval_unit,
    ).unit,
    lastAutoSyncAt: cfg.last_auto_sync_at || null,
    autoSyncDescription: describeBrainmineAutoSync(cfg),
  };
});

export const ensureBrainmineChannel = createServerFn({ method: "POST" }).handler(async () => {
  const supabase = createServiceSupabase();
  const { data: existing } = await supabase
    .from("channels")
    .select("id")
    .eq("org_id", ORG_ID)
    .eq("type", "brainmine")
    .maybeSingle();
  if (existing) return { ok: true, created: false, error: null as string | null };

  const { error } = await supabase.from("channels").insert({
    org_id: ORG_ID,
    type: "brainmine",
    name: "Brainmine CRM+",
    status: "Disconnected",
    health: 0,
    detail: "External CRM lead sync (read-only)",
    is_enabled: false,
    config: {},
  });
  if (error) {
    if (/invalid input value for enum|brainmine/i.test(error.message)) {
      return {
        ok: false,
        created: false,
        error:
          "Run migration 011_brainmine_channel.sql (Step 1), then 011b_brainmine_channel_row.sql in Supabase.",
      };
    }
    return { ok: false, created: false, error: error.message };
  }
  return { ok: true, created: true, error: null as string | null };
});

export const saveBrainmineChannelConfig = createServerFn({ method: "POST" })
  .validator(
    z.object({
      apiBaseUrl: z.string().url().max(400),
      /** Omit or blank to keep existing channel/env key */
      apiKey: z.string().max(500).optional(),
      apiSecret: z.string().max(500).optional(),
      authStyle: z.enum(["bearer", "token", "x-api-key", "query"]).default("token"),
      leadsPath: z.string().max(300).optional(),
      listKey: z.string().max(80).optional(),
      syncLimit: z.number().int().min(1).max(200).optional(),
      enable: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const supabase = createServiceSupabase();
    const prev = await loadBrainmineConfig();
    const nextKey = data.apiKey?.trim() || prev.api_key;
    if (!nextKey) throw new Error("Brainmine API key is required (Channels UI or BRAINMINE_API_KEY).");
    const config: BrainmineChannelConfig = {
      ...prev,
      api_base_url: data.apiBaseUrl.replace(/\/$/, ""),
      api_key: nextKey,
      api_secret: data.apiSecret?.trim() || prev.api_secret,
      auth_style: data.authStyle,
      leads_path: data.leadsPath?.trim() || prev.leads_path || "/api/resource/Lead",
      list_key: data.listKey?.trim() || prev.list_key || "data",
      sync_limit: clampSyncLimit(data.syncLimit ?? prev.sync_limit ?? DEFAULT_SYNC_LIMIT),
      field_map: { ...DEFAULT_FIELD_MAP, ...(prev.field_map || {}) },
    };

    const { error } = await supabase
      .from("channels")
      .update({
        config,
        detail: `Brainmine · ${config.api_base_url} · ${config.sync_limit}/sync`,
        status: "Connected",
        health: 100,
        is_enabled: data.enable ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", ORG_ID)
      .eq("type", "brainmine");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const syncBrainmineLeads = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        /** YYYY-MM-DD — with `to`, pulls leads created in this range */
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    return syncBrainmineWindow({
      from: data?.from,
      to: data?.to,
    });
  });

export const saveBrainmineAutoSync = createServerFn({ method: "POST" })
  .validator(
    z.object({
      enabled: z.boolean(),
      intervalValue: z.number().int().min(1).max(604800),
      intervalUnit: z.enum(["sec", "min", "hr"]),
    }),
  )
  .handler(async ({ data }) => {
    const cfg = await loadBrainmineConfig();
    if (data.enabled && !brainmineConfigReady(cfg)) {
      throw new Error("Configure Brainmine API credentials before enabling auto sync");
    }
    const interval = normalizeBrainmineInterval(data.intervalValue, data.intervalUnit);
    const next: BrainmineChannelConfig = {
      ...cfg,
      auto_sync_enabled: data.enabled,
      auto_sync_interval_value: interval.value,
      auto_sync_interval_unit: interval.unit,
    };
    await persistBrainmineConfig(
      next,
      data.enabled
        ? `Brainmine · auto every ${interval.value}${interval.unit}`
        : `Brainmine · ${cfg.api_base_url || "CRM"} · manual sync`,
    );
    return {
      autoSyncEnabled: Boolean(next.auto_sync_enabled),
      autoSyncIntervalValue: interval.value,
      autoSyncIntervalUnit: interval.unit,
      lastAutoSyncAt: next.last_auto_sync_at || null,
      autoSyncDescription: describeBrainmineAutoSync(next),
    };
  });

/**
 * Cron: if auto sync enabled and due, pull latest updated leads (max 20, upsert).
 */
export async function tickBrainmineAutoSync(): Promise<{
  ran: boolean;
  skipped?: string;
  created?: number;
  updated?: number;
  fetched?: number;
}> {
  const cfg = await loadBrainmineConfig();
  if (!brainmineConfigReady(cfg)) return { ran: false, skipped: "not_configured" };
  if (!isBrainmineAutoSyncDue(cfg)) return { ran: false, skipped: "not_due" };

  try {
    const result = await syncBrainmineWindow();
    const latest = await loadBrainmineConfig();
    await persistBrainmineConfig({
      ...latest,
      last_auto_sync_at: new Date().toISOString(),
    });
    return {
      ran: true,
      created: result.created,
      updated: result.updated,
      fetched: result.fetched,
    };
  } catch (err) {
    return {
      ran: false,
      skipped: err instanceof Error ? err.message : "auto_sync_failed",
    };
  }
}
