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
import { normalizeWhatsAppDigits } from "@/lib/whatsapp-window";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

export type BrainmineAuthStyle = "bearer" | "token" | "x-api-key" | "query";

export type BrainmineFieldMap = {
  id?: string;
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  phone_alt?: string;
  location?: string;
  state?: string;
  country?: string;
  requirement?: string;
  sales_person?: string;
  lead_owner?: string;
  opportunity_owner?: string;
  status?: string;
  notes?: string;
  tags?: string;
  crm_source?: string;
  creation?: string;
  modified?: string;
  industry?: string;
  job_title?: string;
  website?: string;
  territory?: string;
  type?: string;
  annual_revenue?: string;
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
  /** Last cron/manual auto attempt (even if skipped/failed) */
  last_auto_sync_attempt_at?: string;
  /** Short status: ok / skipped / error summary */
  last_auto_sync_result?: string;
  last_auto_sync_error?: string;
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

/** ISO timestamp when the next auto sync becomes due (null if off). */
export function nextBrainmineAutoSyncDueAt(
  cfg: BrainmineChannelConfig,
  now = new Date(),
): string | null {
  if (!cfg.auto_sync_enabled) return null;
  const { value, unit } = normalizeBrainmineInterval(
    cfg.auto_sync_interval_value,
    cfg.auto_sync_interval_unit,
  );
  const needMs = brainmineIntervalToMs(value, unit);
  const lastMs = cfg.last_auto_sync_at ? new Date(cfg.last_auto_sync_at).getTime() : 0;
  if (!Number.isFinite(lastMs) || lastMs <= 0) return now.toISOString();
  return new Date(lastMs + needMs).toISOString();
}

function formatBrainmineAutoSyncResult(opts: {
  created?: number;
  updated?: number;
  fetched?: number;
  skipped?: string;
}): string {
  if (opts.skipped) return opts.skipped;
  const created = opts.created ?? 0;
  const updated = opts.updated ?? 0;
  const fetched = opts.fetched ?? 0;
  return `ok · ${created} new · ${updated} updated · ${fetched} fetched`;
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
  phone_alt: "phone",
  location: "city",
  state: "state",
  country: "country",
  requirement: "query_about",
  sales_person: "owner",
  lead_owner: "lead_owner",
  opportunity_owner: "opportunity_owner",
  status: "status",
  notes: "notes",
  tags: "source",
  crm_source: "source",
  creation: "creation",
  modified: "modified",
  industry: "industry",
  job_title: "job_title",
  website: "website",
  territory: "territory",
  type: "type",
  annual_revenue: "annual_revenue",
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
      field_map: {
        ...DEFAULT_FIELD_MAP,
        ...(cfg.field_map || {}),
        // Engage Requirement ← Brainmine query_about (do not fall back to notes)
        requirement: "query_about",
      },
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
      last_auto_sync_attempt_at: cfg.last_auto_sync_attempt_at,
      last_auto_sync_result: cfg.last_auto_sync_result,
      last_auto_sync_error: cfg.last_auto_sync_error,
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
  return normalizeWhatsAppDigits(raw);
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

function sanitizeCred(raw: string | undefined | null): string {
  return (raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/[\r\n\t]/g, "")
    .trim();
}

function formatBrainmineApiError(json: unknown, status: number, bodyText: string): string {
  const blob =
    bodyText ||
    JSON.stringify(json) ||
    "";

  if (/PermissionError|check_read_permission|has_permission/i.test(blob) || status === 403) {
    const doctype =
      blob.match(/doctype['":\s]+([A-Za-z0-9 %]+)/i)?.[1]?.trim() ||
      blob.match(/resource\/([A-Za-z0-9% ]+)/i)?.[1]?.replace(/%20/g, " ") ||
      "Lead";
    return (
      `Brainmine permission denied: this API user cannot read "${doctype}" records. ` +
      "Ask your Brainmine/ERPNext admin to grant Read permission on Lead for the API key user, then try Sync leads now again."
    );
  }

  if (/AuthenticationError|validate_api_key_secret|401/i.test(blob) || status === 401) {
    return (
      "Brainmine authentication failed. Open Channels → Configure Brainmine and re-save both " +
      "API key and API secret (auth style: token key:secret). Also confirm the same keys work in Brainmine."
    );
  }
  const permitted = blob.match(/Field not permitted in query:\s*([a-zA-Z0-9_]+)/i);
  if (permitted?.[1]) {
    return `Field not permitted in query: ${permitted[1]}`;
  }
  const msg = getByPath(json, "message");
  if (typeof msg === "string" && msg.trim()) {
    const trimmed = msg.trim();
    if (/PermissionError|check_read_permission/i.test(trimmed)) {
      return (
        "Brainmine permission denied: this API user cannot read Lead records. " +
        "Ask Brainmine admin to grant Read permission on Lead for your API key user."
      );
    }
    // Frappe sometimes returns a long Python traceback — don't dump it in the UI.
    if (trimmed.length > 280 || /Traceback \(most recent call last\)/i.test(trimmed)) {
      return (
        "Brainmine returned a server error (likely permissions). " +
        "Ask Brainmine admin to grant Read access on Lead for your API user."
      );
    }
    return trimmed;
  }
  if (Array.isArray(msg) && msg.length) {
    const joined = msg.map((m) => (typeof m === "string" ? m : JSON.stringify(m))).join("\n");
    const again = joined.match(/Field not permitted in query:\s*([a-zA-Z0-9_]+)/i);
    if (again?.[1]) return `Field not permitted in query: ${again[1]}`;
    if (/AuthenticationError/i.test(joined)) {
      return (
        "Brainmine authentication failed. Re-save API key + API secret under Channels → Configure Brainmine."
      );
    }
    if (/PermissionError|check_read_permission/i.test(joined)) {
      return (
        "Brainmine permission denied: this API user cannot read Lead records. " +
        "Ask Brainmine admin to grant Read permission on Lead for your API key user."
      );
    }
    return joined.slice(0, 400);
  }
  return (
    asString(getByPath(json, "error")) ||
    asString(getByPath(json, "exc")) ||
    `Brainmine API error (${status})`
  );
}

function buildAuthHeaders(cfg: BrainmineChannelConfig): Record<string, string> {
  const key = sanitizeCred(cfg.api_key);
  const secret = sanitizeCred(cfg.api_secret);
  const style = cfg.auth_style || "token";
  if (!key) {
    throw new Error("Brainmine API key is missing. Save it under Channels → Configure Brainmine.");
  }
  if (style === "bearer") {
    return { Authorization: `Bearer ${key}` };
  }
  if (style === "token") {
    // ERPNext: Authorization: token api_key:api_secret
    // Support users pasting the full "key:secret" token into the API key field.
    if (key.includes(":")) {
      return { Authorization: `token ${key}` };
    }
    if (!secret) {
      throw new Error(
        "Brainmine API secret is missing. For token auth, save both API key and API secret under Channels → Configure Brainmine.",
      );
    }
    return { Authorization: `token ${key}:${secret}` };
  }
  if (style === "x-api-key") {
    return { "X-API-Key": key };
  }
  return {};
}

function leadListFields(isOpp: boolean): string[] {
  // Only request fields that commonly exist. Invalid ones are dropped automatically on retry.
  return isOpp
    ? [
        "name",
        "party_name",
        "customer_name",
        "contact_email",
        "contact_mobile",
        "contact_display",
        "contact_person",
        "contact_name",
        "city",
        "state",
        "country",
        "status",
        "source",
        "notes",
        "owner",
        "opportunity_owner",
        "industry",
        "territory",
        "website",
        "annual_revenue",
        "query_about",
        "custom_query_about",
        "custom_product_name",
        "items",
        "modified",
        "creation",
      ]
    : [
        "name",
        "lead_name",
        "company_name",
        "email_id",
        "mobile_no",
        "phone",
        "city",
        "state",
        "country",
        "status",
        "source",
        "notes",
        "owner",
        "lead_owner",
        "industry",
        "job_title",
        "website",
        "territory",
        "type",
        "annual_revenue",
        "query_about",
        "custom_query_about",
        "modified",
        "creation",
      ];
}

function extractNotPermittedField(text: string, json: unknown): string | null {
  const blob = `${text || ""}\n${JSON.stringify(json ?? {})}`;
  return blob.match(/Field not permitted in query:\s*([a-zA-Z0-9_]+)/i)?.[1] || null;
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
  const pageSize = clampSyncLimit(
    options?.pageSize ?? cfg.sync_limit ?? DEFAULT_SYNC_LIMIT,
  );
  const isOpp = /Opportunity/i.test(path);
  let fields = /\/(Lead|Opportunity)/i.test(path) ? leadListFields(isOpp) : null;

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

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...buildAuthHeaders(cfg),
  };

  // Retry when CRM rejects a field name (e.g. contact_phone / opportunity_owner)
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const url = new URL(`${base}${path}`);
    url.searchParams.set("limit_page_length", String(pageSize));
    if (options?.limitStart && options.limitStart > 0) {
      url.searchParams.set("limit_start", String(options.limitStart));
    }
    url.searchParams.set(
      "order_by",
      options?.orderBy || (options?.from || options?.to ? "creation desc" : "modified desc"),
    );
    if (fields?.length) {
      url.searchParams.set("fields", JSON.stringify(fields));
    }
    if (filters.length) {
      url.searchParams.set("filters", JSON.stringify(filters));
    }
    if (cfg.auth_style === "query") {
      url.searchParams.set(cfg.query_key_param || "api_key", sanitizeCred(cfg.api_key));
    }

    const res = await fetch(url.toString(), { method: "GET", headers });
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Brainmine returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }

    const badField = extractNotPermittedField(text, json);
    if (badField && fields?.length) {
      const next = fields.filter((f) => f !== badField);
      if (next.length < fields.length) {
        fields = next;
        continue;
      }
    }

    if (res.ok) {
      return extractList(json, cfg.list_key || "data");
    }

    throw new Error(formatBrainmineApiError(json, res.status, text));
  }

  throw new Error("Brainmine sync failed after dropping invalid fields");
}

/** Full document GET — list API often omits / rejects custom fields like query_about */
async function fetchBrainmineDocByName(
  cfg: BrainmineChannelConfig,
  docName: string,
): Promise<Record<string, unknown> | null> {
  const leadsPath = (cfg.leads_path || "/api/resource/Lead").startsWith("/")
    ? cfg.leads_path || "/api/resource/Lead"
    : `/${cfg.leads_path}`;
  try {
    const detailJson = await brainmineGetJson(
      cfg,
      `${leadsPath.replace(/\/$/, "")}/${encodeURIComponent(docName)}`,
    );
    const doc =
      (getByPath(detailJson, "data") as Record<string, unknown> | undefined) ||
      (detailJson as Record<string, unknown>);
    if (doc && typeof doc === "object" && !Array.isArray(doc)) return doc;
  } catch {
    return null;
  }
  return null;
}

function asRequirementText(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  // Text Editor / HTML → plain text
  const plain = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return plain || null;
}

/** Pick query_about (and common custom variants) for Requirement */
function pickQueryAbout(row: Record<string, unknown>): string | null {
  const direct =
    asRequirementText(row.query_about) ||
    asRequirementText(row.custom_query_about) ||
    asRequirementText(row.custom_product_name) ||
    asRequirementText(getByPath(row, "query_about")) ||
    asRequirementText(getByPath(row, "custom_query_about")) ||
    asRequirementText(getByPath(row, "custom_product_name"));
  if (direct) return direct;
  for (const [k, v] of Object.entries(row)) {
    if (
      /^custom_?query_?about$/i.test(k) ||
      /^query_?about$/i.test(k) ||
      /^custom_?product_?name$/i.test(k)
    ) {
      const t = asRequirementText(v);
      if (t) return t;
    }
  }
  // Opportunity often has no query_about — product text lives on Items child table
  return pickRequirementFromItems(row.items);
}

/** ERPNext Opportunity Items: item_name / description often hold “Solar Hybrid Inverter 10kW”. */
function pickRequirementFromItems(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const parts: string[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const label =
      asRequirementText(row.item_name) ||
      asRequirementText(row.description) ||
      asRequirementText(row.item_code) ||
      asRequirementText(row.item) ||
      null;
    if (label) parts.push(label);
  }
  if (!parts.length) return null;
  // Dedupe while preserving order
  return Array.from(new Set(parts)).join("; ");
}

function expandItemsForInspect(items: unknown): Array<Record<string, string>> {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 20).map((raw, idx) => {
    if (!raw || typeof raw !== "object") {
      return { index: String(idx), preview: previewValue(raw) };
    }
    const row = raw as Record<string, unknown>;
    const keys = [
      "item_code",
      "item_name",
      "description",
      "item",
      "qty",
      "uom",
      "rate",
      "amount",
    ];
    const out: Record<string, string> = { index: String(idx) };
    for (const k of keys) {
      const v = asRequirementText(row[k]) || asString(row[k]);
      if (v) out[k] = v;
    }
    if (Object.keys(out).length <= 1) {
      out.preview = previewValue(row, 220);
    }
    return out;
  });
}

function doctypeFromLeadsPath(leadsPath: string): string {
  const m = leadsPath.match(/\/resource\/([^/?#]+)/i);
  if (!m?.[1]) return "Lead";
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * List responses often lack custom fields / items. If requirement is missing, fetch full docs
 * (and for Opportunity, try linked Lead) so Requirement can fill.
 */
async function enrichRowsWithQueryAbout(
  cfg: BrainmineChannelConfig,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    let merged: Record<string, unknown> = row;
    if (!pickQueryAbout(merged)) {
      const id = asString(row.name) || asString(row.id);
      if (id) {
        const full = await fetchBrainmineDocByName(cfg, id);
        if (full) merged = { ...row, ...full };
      }
    }
    if (!pickQueryAbout(merged) || !asString(merged.lead_name) || !asString(merged.contact_display)) {
      const party = asString(merged.party_name);
      if (party && /^CRM-LEAD/i.test(party)) {
        try {
          const leadJson = await brainmineGetJson(
            cfg,
            `/api/resource/Lead/${encodeURIComponent(party)}`,
          );
          const leadDoc =
            (getByPath(leadJson, "data") as Record<string, unknown> | undefined) ||
            (leadJson as Record<string, unknown>);
          const leadReq = pickQueryAbout(leadDoc);
          const leadName =
            asString(leadDoc.lead_name) ||
            asString(leadDoc.contact_name) ||
            [asString(leadDoc.first_name), asString(leadDoc.last_name)].filter(Boolean).join(" ").trim() ||
            null;
          merged = {
            ...merged,
            ...(leadReq && !pickQueryAbout(merged) ? { query_about: leadReq } : {}),
            ...(leadName && !asString(merged.lead_name) ? { lead_name: leadName } : {}),
            ...(!asString(merged.contact_display) && asString(leadDoc.lead_name)
              ? { contact_display: asString(leadDoc.lead_name) }
              : {}),
          };
        } catch {
          // Linked Lead may be permission-blocked — keep Opportunity as-is
        }
      }
    }
    out.push(merged);
  }
  return out;
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

  // List API often omits custom query_about — pull full docs so Requirement fills
  const enrichedRows = await enrichRowsWithQueryAbout(cfg, allRows);

  // Deduplicate by Brainmine id within this batch (API should not repeat; belt-and-suspenders)
  const seen = new Set<string>();
  const uniqueRows: Record<string, unknown>[] = [];
  for (const row of enrichedRows) {
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

function parseCrmDate(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // ERPNext: "YYYY-MM-DD HH:MM:SS.ffffff"
  const isoish = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const d = new Date(isoish);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const d2 = new Date(trimmed);
  return Number.isNaN(d2.getTime()) ? null : d2.toISOString();
}

/** Intake/support inboxes — never treat as Sales Person */
const NON_SALES_EMAILS = new Set([
  "customercare@enertechups.com",
  "noreply@enertechups.com",
  "no-reply@enertechups.com",
  "admin@enertechups.com",
]);

function isUsableSalesEmail(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  if (!v.includes("@")) return false;
  if (NON_SALES_EMAILS.has(v)) return false;
  return true;
}

/** Parse Frappe `_assign` JSON list → first usable sales email */
function firstAssigneeEmail(raw: unknown): string | null {
  if (raw == null) return null;
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s) as unknown;
        if (Array.isArray(parsed)) list = parsed;
        else list = [s];
      } catch {
        list = [s];
      }
    } else {
      list = [s];
    }
  }
  for (const item of list) {
    const email = asString(item);
    if (isUsableSalesEmail(email)) return email.trim();
  }
  return null;
}

/**
 * Sales Person priority:
 * 1) opportunity_owner
 * 2) lead_owner
 * 3) first _assign (Assign To)
 * 4) document owner — only if a real sales email (creator can be the same as opportunity owner)
 * Skips customercare@ and similar non-sales inboxes.
 */
function resolveSalesPerson(row: Record<string, unknown>, fm: Required<BrainmineFieldMap>): {
  salesPerson: string | null;
  opportunityOwner: string | null;
  leadOwner: string | null;
  assignee: string | null;
  docOwner: string | null;
} {
  const opportunityOwner =
    asString(getByPath(row, fm.opportunity_owner)) ||
    asString(row.opportunity_owner) ||
    null;
  const leadOwner =
    asString(getByPath(row, fm.lead_owner)) ||
    asString(row.lead_owner) ||
    null;
  const assignee = firstAssigneeEmail(row._assign ?? row.assign_to);
  const docOwner = asString(getByPath(row, fm.sales_person)) || asString(row.owner) || null;

  // Same person as creator + opportunity owner is fine — we just pick the first usable email.
  const salesPerson =
    (isUsableSalesEmail(opportunityOwner) ? opportunityOwner.trim() : null) ||
    (isUsableSalesEmail(leadOwner) ? leadOwner.trim() : null) ||
    assignee ||
    (isUsableSalesEmail(docOwner) ? docOwner.trim() : null) ||
    null;

  return { salesPerson, opportunityOwner, leadOwner, assignee, docOwner };
}

function isCrmDocumentRef(value: string | null | undefined): boolean {
  const s = (value || "").trim();
  if (!s) return false;
  // Brainmine / ERPNext naming series ids must never become the person Name column
  return /^(CRM-LEAD|CRM-OPP|LEAD-|OPP-|OPTY-)/i.test(s);
}

/** Person name for Engage — never use CRM-LEAD / CRM-OPP document ids. */
function pickPersonName(row: Record<string, unknown>, fm: Required<BrainmineFieldMap>): string {
  const mapped = asString(getByPath(row, fm.name));
  const contactDisplay = asString(row.contact_display);
  const contactPersonRaw = asString(row.contact_person);
  const contactPerson =
    contactPersonRaw && /-\d+$/.test(contactPersonRaw)
      ? contactPersonRaw.replace(/-\d+$/, "").trim()
      : contactPersonRaw;
  const fullName =
    [asString(row.first_name), asString(row.last_name)].filter(Boolean).join(" ").trim() || null;
  const candidates = [
    mapped && !isCrmDocumentRef(mapped) ? mapped : null,
    asString(row.lead_name),
    contactDisplay,
    contactPerson,
    asString(row.contact_name),
    asString(row.full_name),
    fullName,
    asString(row.customer_name) && !isCrmDocumentRef(asString(row.customer_name))
      ? asString(row.customer_name)
      : null,
    asString(row.title) && !isCrmDocumentRef(asString(row.title)) ? asString(row.title) : null,
  ].filter((v): v is string => Boolean(v && String(v).trim() && !isCrmDocumentRef(v)));

  return candidates[0] || "Brainmine lead";
}

function pickCompanyName(row: Record<string, unknown>, fm: Required<BrainmineFieldMap>): string | null {
  const mapped = asString(getByPath(row, fm.company));
  const candidates = [
    mapped && !isCrmDocumentRef(mapped) ? mapped : null,
    asString(row.company_name),
    asString(row.customer_name),
    asString(row.title),
  ].filter((v): v is string => Boolean(v && String(v).trim() && !isCrmDocumentRef(v)));
  return candidates[0] || null;
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
  crmSource: string | null;
  crmCreatedAt: string | null;
  crmModifiedAt: string | null;
  valueLabel: string | null;
  metadataExtra: Record<string, unknown>;
} {
  const fm = { ...DEFAULT_FIELD_MAP, ...fieldMap };
  const externalId =
    asString(getByPath(row, fm.id)) ||
    asString(row.id) ||
    asString(row.name) ||
    asString(row.uuid) ||
    "";
  const name = pickPersonName(row, fm);
  const company = pickCompanyName(row, fm);
  const email =
    asString(getByPath(row, fm.email)) ||
    asString(row.contact_email) ||
    null;
  const mobile = cleanPhone(
    asString(getByPath(row, fm.phone)) || asString(row.contact_mobile),
  );
  const landline = cleanPhone(
    asString(getByPath(row, fm.phone_alt)) || asString(row.contact_phone),
  );
  const phone = mobile || landline;
  const city = asString(getByPath(row, fm.location));
  const state = asString(getByPath(row, fm.state));
  const country = asString(getByPath(row, fm.country));
  const location =
    [city, state, country].filter(Boolean).join(", ") || null;
  const requirement =
    pickQueryAbout(row) ||
    asRequirementText(getByPath(row, fm.requirement)) ||
    null;
  const { salesPerson, opportunityOwner, leadOwner, assignee, docOwner } =
    resolveSalesPerson(row, fm);
  const status = mapBrainmineStatus(asString(getByPath(row, fm.status)));
  // Notes stay separate from Requirement (query_about)
  const notes = asString(getByPath(row, fm.notes));
  const crmSource = asString(getByPath(row, fm.crm_source));
  const tagRaw = asString(getByPath(row, fm.tags));
  const tags = [
    "brainmine",
    ...(crmSource ? [crmSource] : tagRaw && tagRaw !== crmSource ? [tagRaw] : []),
  ];
  const industry = asString(getByPath(row, fm.industry));
  const jobTitle = asString(getByPath(row, fm.job_title));
  const website = asString(getByPath(row, fm.website));
  const territory = asString(getByPath(row, fm.territory));
  const leadType = asString(getByPath(row, fm.type));
  const annualRevenue = asString(getByPath(row, fm.annual_revenue));
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
    crmSource,
    crmCreatedAt: parseCrmDate(asString(getByPath(row, fm.creation))),
    crmModifiedAt: parseCrmDate(asString(getByPath(row, fm.modified))),
    valueLabel: annualRevenue,
    metadataExtra: {
      opportunity_owner: opportunityOwner,
      lead_owner: leadOwner,
      assign_to: assignee,
      owner: docOwner,
      industry,
      job_title: jobTitle,
      website,
      territory,
      lead_type: leadType,
      annual_revenue: annualRevenue,
      query_about: requirement,
      city,
      state,
      country,
      mobile_no: mobile,
      phone_landline: landline,
    },
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
    crm_source: mapped.crmSource,
    crm_created_at: mapped.crmCreatedAt,
    crm_modified_at: mapped.crmModifiedAt,
    value_label: mapped.valueLabel,
    last_activity_at: now,
    metadata: {
      brainmine_id: mapped.externalId,
      brainmine: true,
      remarketing: true,
      crm_source: mapped.crmSource,
      ...mapped.metadataExtra,
      raw: row,
    },
  };

  if (existing) {
    const { error } = await supabase
      .from("leads")
      .update({
        ...payload,
        // Keep previous Requirement if this sync did not receive query_about
        requirement: mapped.requirement || existing.requirement || null,
        product_label: mapped.requirement || existing.requirement || null,
        external_ref: mapped.externalId,
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
      external_ref: mapped.externalId,
      score: 60,
      priority: "Medium",
      next_follow_up_at: now,
      ...payload,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  try {
    const { runAutomations } = await import("@/server/automation-engine");
    // New lead only (duplicates update existing and skip this path)
    const ctx = {
      leadId: lead.id as string,
      source: "brainmine",
      phone: mapped.phone,
      email: mapped.email,
      leadName: mapped.name,
      company: mapped.company,
      salesPerson: mapped.salesPerson,
      requirement: mapped.requirement,
      location: mapped.location,
      leadStatus: mapped.status,
    };
    const bm = await runAutomations("brainmine_lead", ctx);
    const created = await runAutomations("lead_created", ctx);
    console.info("brainmine lead automation", {
      leadId: lead.id,
      phone: mapped.phone,
      brainmine_lead: bm,
      lead_created: created,
    });
  } catch (err) {
    console.error("brainmine lead automation", err);
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
    lastAutoSyncAttemptAt: cfg.last_auto_sync_attempt_at || null,
    lastAutoSyncResult: cfg.last_auto_sync_result || null,
    lastAutoSyncError: cfg.last_auto_sync_error || null,
    nextAutoSyncDueAt: nextBrainmineAutoSyncDueAt(cfg),
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
      field_map: {
        ...DEFAULT_FIELD_MAP,
        ...(prev.field_map || {}),
        requirement: "query_about",
      },
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
      // Force next cron tick to run soon when turning On / saving schedule
      ...(data.enabled
        ? {
            last_auto_sync_at: undefined,
            last_auto_sync_error: undefined,
            last_auto_sync_result: "schedule_saved — waiting for cron (≈5 min)",
            last_auto_sync_attempt_at: new Date().toISOString(),
          }
        : {
            last_auto_sync_result: "auto sync off",
          }),
    };
    // Explicitly clear due clock so JSON doesn't keep a stale ISO from spread
    if (data.enabled) {
      delete next.last_auto_sync_at;
      delete next.last_auto_sync_error;
    }
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
      lastAutoSyncAttemptAt: next.last_auto_sync_attempt_at || null,
      lastAutoSyncResult: next.last_auto_sync_result || null,
      lastAutoSyncError: next.last_auto_sync_error || null,
      nextAutoSyncDueAt: nextBrainmineAutoSyncDueAt(next),
      autoSyncDescription: describeBrainmineAutoSync(next),
    };
  });

/**
 * Cron: if auto sync enabled and due, pull latest updated leads (max 20, upsert).
 * Pass force=true to run even when the interval is not due (UI "Run auto sync now").
 */
export async function tickBrainmineAutoSync(opts?: {
  force?: boolean;
}): Promise<{
  ran: boolean;
  skipped?: string;
  created?: number;
  updated?: number;
  fetched?: number;
}> {
  const force = Boolean(opts?.force);
  const cfg = await loadBrainmineConfig();
  const attemptAt = new Date().toISOString();

  const stampAttempt = async (
    patch: Partial<BrainmineChannelConfig>,
    clearError = false,
  ) => {
    const latest = await loadBrainmineConfig();
    const next: BrainmineChannelConfig = {
      ...latest,
      last_auto_sync_attempt_at: attemptAt,
      ...patch,
    };
    if (clearError) delete next.last_auto_sync_error;
    await persistBrainmineConfig(next);
  };

  if (!brainmineConfigReady(cfg)) {
    await stampAttempt({
      last_auto_sync_result: "skipped: not_configured",
      last_auto_sync_error: "Configure Brainmine API credentials",
    });
    return { ran: false, skipped: "not_configured" };
  }
  if (!cfg.auto_sync_enabled && !force) {
    return { ran: false, skipped: "disabled" };
  }
  if (!force && !isBrainmineAutoSyncDue(cfg)) {
    // Prove cron is alive without overwriting the last success/error summary
    await stampAttempt({});
    return { ran: false, skipped: "not_due" };
  }

  try {
    const result = await syncBrainmineWindow();
    const summary = formatBrainmineAutoSyncResult({
      created: result.created,
      updated: result.updated,
      fetched: result.fetched,
    });
    await stampAttempt(
      {
        last_auto_sync_at: new Date().toISOString(),
        last_auto_sync_result: summary,
      },
      true,
    );
    return {
      ran: true,
      created: result.created,
      updated: result.updated,
      fetched: result.fetched,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "auto_sync_failed";
    await stampAttempt({
      last_auto_sync_result: `error: ${msg}`,
      last_auto_sync_error: msg,
    });
    return {
      ran: false,
      skipped: msg,
    };
  }
}

export const runBrainmineAutoSyncNow = createServerFn({ method: "POST" }).handler(async () => {
  const cfg = await loadBrainmineConfig();
  if (!brainmineConfigReady(cfg)) {
    throw new Error("Configure Brainmine API credentials first");
  }
  if (!cfg.auto_sync_enabled) {
    throw new Error("Turn Auto lead sync On and Save schedule first");
  }
  const result = await tickBrainmineAutoSync({ force: true });
  if (!result.ran) {
    throw new Error(result.skipped || "Auto sync did not run");
  }
  return {
    created: result.created ?? 0,
    updated: result.updated ?? 0,
    fetched: result.fetched ?? 0,
    lastAutoSyncAt: new Date().toISOString(),
  };
});

const REQUIREMENT_KEY_RE =
  /requir|quer|enquir|product|message|subject|interest|item|kva|inverter|ups|solar|hybrid|catalogue|catalog|need|request_type|market_segment|notes|comment|detail|description|title/i;

function previewValue(v: unknown, max = 160): string {
  if (v == null) return "";
  if (typeof v === "string") return v.length > max ? `${v.slice(0, max)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return String(v);
  }
}

async function brainmineGetJson(
  cfg: BrainmineChannelConfig,
  pathAndQuery: string,
): Promise<unknown> {
  const base = cfg.api_base_url!.replace(/\/$/, "");
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  const url = new URL(`${base}${path}`);
  if (cfg.auth_style === "query") {
    url.searchParams.set(cfg.query_key_param || "api_key", cfg.api_key!);
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...buildAuthHeaders(cfg),
    },
  });
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Brainmine returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(formatBrainmineApiError(json, res.status, text));
  }
  return json;
}

/**
 * Step A — read-only discovery: one full Lead/Opportunity + Items + linked Lead
 * + DocField/Custom Field hints for Requirement / Query mapping.
 */
export const inspectBrainmineLeadFields = createServerFn({ method: "POST" }).handler(async () => {
  const cfg = await loadBrainmineConfig();
  if (!brainmineConfigReady(cfg)) {
    throw new Error("Configure Brainmine API base URL and API key under Channels first.");
  }

  const leadsPath = (cfg.leads_path || "/api/resource/Lead").startsWith("/")
    ? cfg.leads_path || "/api/resource/Lead"
    : `/${cfg.leads_path}`;
  const doctype = doctypeFromLeadsPath(leadsPath);
  const isOpp = /opportunity/i.test(doctype);

  // 1) List latest id (name) only
  const listJson = await brainmineGetJson(
    cfg,
    `${leadsPath}?limit_page_length=1&order_by=${encodeURIComponent("modified desc")}&fields=${encodeURIComponent(JSON.stringify(["name"]))}`,
  );
  const listRows = extractList(listJson, cfg.list_key || "data");
  const firstId =
    asString(listRows[0]?.name) ||
    asString(listRows[0]?.id) ||
    null;
  if (!firstId) {
    throw new Error("No leads found in Brainmine to inspect. Create or sync at least one Lead in CRM.");
  }

  // 2) Full document (no fields filter) — this is what CRM can send
  const detailPath = `${leadsPath.replace(/\/$/, "")}/${encodeURIComponent(firstId)}`;
  const detailJson = await brainmineGetJson(cfg, detailPath);
  const doc =
    (getByPath(detailJson, "data") as Record<string, unknown> | undefined) ||
    (detailJson as Record<string, unknown>);

  const allFields = Object.keys(doc)
    .filter((k) => !k.startsWith("_"))
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const value = doc[key];
      const valuePreview = previewValue(value);
      const empty =
        value == null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);
      return {
        key,
        valuePreview,
        empty,
        looksLikeRequirement: REQUIREMENT_KEY_RE.test(key) && !empty,
      };
    });

  const candidatesFromSample = allFields.filter((f) => f.looksLikeRequirement);
  const itemsExpanded = expandItemsForInspect(doc.items);
  const resolvedRequirement = pickQueryAbout(doc);

  // 2b) If Opportunity, also inspect linked Lead (party_name) for query_about
  let linkedLead: {
    id: string;
    fieldCount: number;
    hasQueryAbout: boolean;
    requirementPreview: string | null;
    queryLikeFields: Array<{ key: string; valuePreview: string; empty: boolean }>;
  } | null = null;
  const partyName = asString(doc.party_name);
  if (isOpp && partyName && /^CRM-LEAD/i.test(partyName)) {
    try {
      const leadJson = await brainmineGetJson(
        cfg,
        `/api/resource/Lead/${encodeURIComponent(partyName)}`,
      );
      const leadDoc =
        (getByPath(leadJson, "data") as Record<string, unknown> | undefined) ||
        (leadJson as Record<string, unknown>);
      const leadReq = pickQueryAbout(leadDoc);
      const leadFields = Object.keys(leadDoc)
        .filter((k) => !k.startsWith("_"))
        .map((key) => {
          const value = leadDoc[key];
          const valuePreview = previewValue(value);
          const empty =
            value == null ||
            value === "" ||
            (Array.isArray(value) && value.length === 0);
          return {
            key,
            valuePreview,
            empty,
            looksLikeRequirement: REQUIREMENT_KEY_RE.test(key) && !empty,
          };
        });
      linkedLead = {
        id: partyName,
        fieldCount: leadFields.length,
        hasQueryAbout: Boolean(
          asRequirementText(leadDoc.query_about) ||
            asRequirementText(leadDoc.custom_query_about),
        ),
        requirementPreview: leadReq,
        queryLikeFields: leadFields.filter((f) => f.looksLikeRequirement),
      };
    } catch {
      linkedLead = {
        id: partyName,
        fieldCount: 0,
        hasQueryAbout: false,
        requirementPreview: null,
        queryLikeFields: [],
      };
    }
  }

  // 3) DocField / Custom Field meta for the *actual* synced DocType
  let metaFields: Array<{ fieldname: string; label: string; fieldtype: string }> = [];
  let metaError: string | null = null;
  try {
    const metaJson = await brainmineGetJson(
      cfg,
      `/api/resource/DocField?limit_page_length=500&fields=${encodeURIComponent(
        JSON.stringify(["fieldname", "label", "fieldtype"]),
      )}&filters=${encodeURIComponent(JSON.stringify([["parent", "=", doctype]]))}`,
    );
    const rows = extractList(metaJson, "data");
    metaFields = rows
      .map((r) => ({
        fieldname: asString(r.fieldname) || "",
        label: asString(r.label) || "",
        fieldtype: asString(r.fieldtype) || "",
      }))
      .filter((r) => r.fieldname);
  } catch (err) {
    metaError = err instanceof Error ? err.message : "DocField meta unavailable";
    metaFields = [];
  }

  let customFields: Array<{ fieldname: string; label: string; fieldtype: string }> = [];
  let customError: string | null = null;
  try {
    const customJson = await brainmineGetJson(
      cfg,
      `/api/resource/Custom%20Field?limit_page_length=200&fields=${encodeURIComponent(
        JSON.stringify(["fieldname", "label", "fieldtype", "dt"]),
      )}&filters=${encodeURIComponent(JSON.stringify([["dt", "=", doctype]]))}`,
    );
    const rows = extractList(customJson, "data");
    customFields = rows
      .map((r) => ({
        fieldname: asString(r.fieldname) || "",
        label: asString(r.label) || "",
        fieldtype: asString(r.fieldtype) || "",
      }))
      .filter((r) => r.fieldname);
  } catch (err) {
    customError = err instanceof Error ? err.message : "Custom Field meta unavailable";
    customFields = [];
  }

  const metaCandidates = [...metaFields, ...customFields]
    .filter(
      (f) =>
        REQUIREMENT_KEY_RE.test(f.fieldname) || REQUIREMENT_KEY_RE.test(f.label),
    )
    .map((f) => {
      const sample = allFields.find((a) => a.key === f.fieldname);
      return {
        key: f.fieldname,
        label: f.label,
        fieldtype: f.fieldtype,
        valuePreview: sample?.valuePreview || "",
        empty: sample ? sample.empty : true,
        source: customFields.some((c) => c.fieldname === f.fieldname)
          ? ("custom" as const)
          : ("doctype" as const),
      };
    });

  const seenMeta = new Set<string>();
  const uniqueMetaCandidates = metaCandidates.filter((m) => {
    if (seenMeta.has(m.key)) return false;
    seenMeta.add(m.key);
    return true;
  });

  const hasTopLevelQuery =
    Object.prototype.hasOwnProperty.call(doc, "query_about") ||
    Object.prototype.hasOwnProperty.call(doc, "custom_query_about");

  let diagnosis: string;
  if (resolvedRequirement) {
    diagnosis = `Engage can fill Requirement from this document (resolved preview: “${resolvedRequirement.slice(0, 120)}”). Source preference: query_about → custom_product_name → Opportunity items.item_name/description.`;
  } else if (itemsExpanded.length) {
    diagnosis =
      "No query_about / custom_query_about text on this document. Items rows exist but item_name/description were empty or unreadable — open Items in Brainmine UI or check API permissions on child table fields.";
  } else if (linkedLead?.requirementPreview) {
    diagnosis = `No requirement on the Opportunity; linked Lead ${linkedLead.id} has text we can use after Lead enrich.`;
  } else if (!hasTopLevelQuery) {
    diagnosis =
      "Brainmine is not exposing any query_about / Query About field on this DocType via API. Requirement text is either not stored, stored only in UI-only fields, or blocked by API user permissions. Ask Brainmine admin to add a Data/Text/Long Text custom field (e.g. custom_query_about) on Opportunity/Lead and grant Read to the API user — or confirm product text should come from Items.";
  } else {
    diagnosis =
      "query_about field exists but is empty on this sample. Inspect another Opportunity/Lead that clearly shows product text in Brainmine UI.";
  }

  return {
    leadId: firstId,
    leadsPath,
    doctype,
    sampleFieldCount: allFields.length,
    resolvedRequirement,
    itemsExpanded,
    linkedLead,
    candidatesFromSample,
    candidatesFromMeta: uniqueMetaCandidates,
    allFields,
    customFieldCount: customFields.length,
    docFieldCount: metaFields.length,
    metaError,
    customError,
    diagnosis,
    hint: "If Items show item_name/description, Engage now maps those to Requirement automatically. If still empty, Brainmine must expose a Query field on the API.",
  };
});
