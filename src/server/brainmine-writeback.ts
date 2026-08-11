/**
 * Brainmine Follow Up write-back — SEPARATE from lead sync.
 *
 * Sync (brainmine.ts) stays GET-only into Engage /leads.
 * This module only appends Follow Up Activity rows on a CRM Lead/Opportunity
 * when staff clicks the manual “Write follow-ups to Brainmine” button.
 *
 * Field mapping (locked with product):
 * - Follow up type → channel (WhatsApp)
 * - Contact with → customer name
 * - Next Follow Up Date → push date + 4 days
 * - Description → conversation summary
 */
import { createServerFn } from "@tanstack/react-start";
import { createServiceSupabase } from "@/lib/supabase";
import {
  brainmineConfigReady,
  brainmineHttpJson,
  loadBrainmineConfig,
  type BrainmineChannelConfig,
} from "@/server/brainmine";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const MAX_BATCH = 40;
const SUMMARY_MAX_CHARS = 480;
const FOLLOW_UP_DAYS = 4;

type WritebackMap = {
  follow_up_table: string;
  type_field: string;
  contact_field: string;
  next_date_field: string;
  description_field: string;
  type_value_whatsapp: string;
};

const DEFAULT_MAP: WritebackMap = {
  follow_up_table: "follow_up_details",
  type_field: "follow_up_type",
  contact_field: "contact_with",
  next_date_field: "next_follow_up_date",
  description_field: "description",
  type_value_whatsapp: "WhatsApp",
};

const TABLE_CANDIDATES = [
  "follow_up_details",
  "follow_up_activity",
  "followups",
  "follow_ups",
  "custom_follow_up_details",
  "follow_up",
];

function resolveWritebackMap(cfg: BrainmineChannelConfig): WritebackMap {
  const w = cfg.writeback || {};
  return {
    follow_up_table: w.follow_up_table?.trim() || DEFAULT_MAP.follow_up_table,
    type_field: w.type_field?.trim() || DEFAULT_MAP.type_field,
    contact_field: w.contact_field?.trim() || DEFAULT_MAP.contact_field,
    next_date_field: w.next_date_field?.trim() || DEFAULT_MAP.next_date_field,
    description_field: w.description_field?.trim() || DEFAULT_MAP.description_field,
    type_value_whatsapp: w.type_value_whatsapp?.trim() || DEFAULT_MAP.type_value_whatsapp,
  };
}

function leadsPath(cfg: BrainmineChannelConfig): string {
  const p = (cfg.leads_path || "/api/resource/Lead").trim();
  return p.startsWith("/") ? p.replace(/\/$/, "") : `/${p}`.replace(/\/$/, "");
}

function ymdPlusDays(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayYmd(): string {
  return ymdPlusDays(0);
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function asDoc(json: unknown): Record<string, unknown> {
  const data = getByPath(json, "data");
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  if (json && typeof json === "object" && !Array.isArray(json)) {
    return json as Record<string, unknown>;
  }
  throw new Error("Brainmine document response was empty");
}

function detectFollowUpTable(doc: Record<string, unknown>, preferred: string): string | null {
  if (Array.isArray(doc[preferred])) return preferred;
  for (const key of TABLE_CANDIDATES) {
    if (Array.isArray(doc[key])) return key;
  }
  for (const [key, value] of Object.entries(doc)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    if (!/follow/i.test(key)) continue;
    const first = value[0];
    if (first && typeof first === "object") return key;
  }
  // Empty child table still usable if name matches
  if (Object.prototype.hasOwnProperty.call(doc, preferred)) return preferred;
  for (const key of TABLE_CANDIDATES) {
    if (Object.prototype.hasOwnProperty.call(doc, key)) return key;
  }
  return null;
}

function buildConversationSummary(
  messages: Array<{ sender: string; body: string }>,
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
    lines.push(`${who}: ${body.slice(0, 160)}`);
    if (lines.join(" | ").length >= SUMMARY_MAX_CHARS) break;
  }
  if (!lines.length) return "";
  return lines.join(" · ").slice(0, SUMMARY_MAX_CHARS);
}

/** Two-line preview for Leads grid. */
export function truncateSummaryForDisplay(summary: string | null | undefined): string {
  const s = String(summary || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  // ~2 short lines of UI text
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

function sameCalendarDay(iso: string | null | undefined, day: string): boolean {
  if (!iso) return false;
  return String(iso).slice(0, 10) === day;
}

async function fetchCrmDoc(
  cfg: BrainmineChannelConfig,
  docName: string,
): Promise<Record<string, unknown>> {
  const path = `${leadsPath(cfg)}/${encodeURIComponent(docName)}`;
  const json = await brainmineHttpJson(cfg, path, { method: "GET" });
  return asDoc(json);
}

async function appendFollowUpRow(options: {
  cfg: BrainmineChannelConfig;
  docName: string;
  map: WritebackMap;
  contactName: string;
  summary: string;
  followUpType: string;
}): Promise<{ table: string }> {
  const { cfg, docName, map, contactName, summary, followUpType } = options;
  const doc = await fetchCrmDoc(cfg, docName);
  const table = detectFollowUpTable(doc, map.follow_up_table);
  if (!table) {
    throw new Error(
      `Could not find Follow Up child table on CRM doc ${docName}. ` +
        `Expected one of: ${[map.follow_up_table, ...TABLE_CANDIDATES].join(", ")}. ` +
        `Ask Brainmine for the child table fieldname, then we can set channels.config.writeback.follow_up_table.`,
    );
  }

  const existing = Array.isArray(doc[table]) ? [...(doc[table] as Record<string, unknown>[])] : [];
  const nextDate = ymdPlusDays(FOLLOW_UP_DAYS);
  const row: Record<string, unknown> = {
    [map.type_field]: followUpType,
    [map.contact_field]: contactName,
    [map.next_date_field]: nextDate,
    [map.description_field]: summary,
  };
  existing.push(row);

  const payload = { ...doc, [table]: existing };
  // Frappe rejects read-only / system keys sometimes — keep name for identity
  delete payload.__onload;
  delete payload._user_tags;
  delete payload._comments;
  delete payload._assign;
  delete payload._liked_by;

  await brainmineHttpJson(cfg, `${leadsPath(cfg)}/${encodeURIComponent(docName)}`, {
    method: "PUT",
    body: payload,
  });
  return { table };
}

export type WritebackRunResult = {
  written: number;
  skipped: number;
  failed: number;
  updatedSummaries: number;
  errors: string[];
  ranAt: string;
};

/**
 * Manual batch: Brainmine-linked leads → conversation summary → CRM Follow Up row.
 * Does not call lead sync / ingest.
 */
export async function runBrainmineFollowUpWriteback(): Promise<WritebackRunResult> {
  const cfg = await loadBrainmineConfig();
  if (!brainmineConfigReady(cfg)) {
    throw new Error("Configure Brainmine API credentials under Channels first.");
  }
  const map = resolveWritebackMap(cfg);
  const supabase = createServiceSupabase();
  const ranAt = new Date().toISOString();
  const today = todayYmd();

  const { data: leads, error: leadErr } = await supabase
    .from("leads")
    .select("id, name, phone, email, source, external_ref, metadata, next_follow_up_at")
    .eq("org_id", ORG_ID)
    .eq("source", "brainmine")
    .order("last_activity_at", { ascending: false })
    .limit(200);
  if (leadErr) throw new Error(leadErr.message);

  const candidates = (leads || []).filter((l) => {
    const meta = (l.metadata && typeof l.metadata === "object" ? l.metadata : {}) as Record<
      string,
      unknown
    >;
    return Boolean(String(meta.brainmine_id || "").trim());
  });

  let written = 0;
  let skipped = 0;
  let failed = 0;
  let updatedSummaries = 0;
  const errors: string[] = [];
  let processed = 0;

  for (const lead of candidates) {
    if (processed >= MAX_BATCH) break;
    processed += 1;

    const meta = {
      ...((lead.metadata && typeof lead.metadata === "object" ? lead.metadata : {}) as Record<
        string,
        unknown
      >),
    };
    const brainmineId = String(meta.brainmine_id || "").trim();
    if (!brainmineId) {
      skipped += 1;
      continue;
    }

    const { data: convos } = await supabase
      .from("conversations")
      .select("id, channel, visitor_name, preview, last_message_at")
      .eq("org_id", ORG_ID)
      .eq("lead_id", lead.id)
      .order("last_message_at", { ascending: false })
      .limit(5);

    const preferred =
      (convos || []).find((c) => c.channel === "whatsapp") || (convos || [])[0] || null;
    if (!preferred) {
      skipped += 1;
      continue;
    }

    const { data: messages } = await supabase
      .from("messages")
      .select("sender, body, created_at")
      .eq("conversation_id", preferred.id)
      .order("created_at", { ascending: false })
      .limit(16);

    const chronological = [...(messages || [])].reverse();
    const summary = buildConversationSummary(
      chronological.map((m) => ({ sender: String(m.sender), body: String(m.body || "") })),
    );
    if (!summary) {
      skipped += 1;
      continue;
    }

    // Always refresh Leads “Follow-up summary” column locally
    meta.follow_up_summary = summary;
    updatedSummaries += 1;

    if (sameCalendarDay(String(meta.brainmine_followup_written_at || ""), today)) {
      const prev = String(meta.brainmine_followup_summary_hash || "");
      if (prev === summary.slice(0, 120)) {
        await supabase
          .from("leads")
          .update({
            metadata: meta,
            next_follow_up_at: ymdPlusDays(FOLLOW_UP_DAYS) + "T10:00:00.000Z",
          })
          .eq("id", lead.id);
        skipped += 1;
        continue;
      }
    }

    const contactName =
      String(preferred.visitor_name || lead.name || "").trim() || "Customer";
    const followUpType =
      preferred.channel === "whatsapp" || preferred.channel === "website"
        ? map.type_value_whatsapp
        : map.type_value_whatsapp;

    try {
      await appendFollowUpRow({
        cfg,
        docName: brainmineId,
        map,
        contactName,
        summary,
        followUpType,
      });
      meta.brainmine_followup_written_at = ranAt;
      meta.brainmine_followup_summary_hash = summary.slice(0, 120);
      meta.brainmine_followup_next_date = ymdPlusDays(FOLLOW_UP_DAYS);
      await supabase
        .from("leads")
        .update({
          metadata: meta,
          next_follow_up_at: `${ymdPlusDays(FOLLOW_UP_DAYS)}T10:00:00.000Z`,
          last_activity_at: ranAt,
        })
        .eq("id", lead.id);
      written += 1;
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : "write failed";
      errors.push(`${lead.name || lead.id}: ${msg}`);
      // Still persist local summary so Leads column updates
      try {
        await supabase.from("leads").update({ metadata: meta }).eq("id", lead.id);
      } catch {
        /* ignore local persist failure */
      }
    }
  }

  // Persist last write-back result on channel config (does not touch sync stamps)
  try {
    const nextCfg: BrainmineChannelConfig = {
      ...cfg,
      writeback: {
        ...(cfg.writeback || {}),
        follow_up_table: map.follow_up_table,
        type_field: map.type_field,
        contact_field: map.contact_field,
        next_date_field: map.next_date_field,
        description_field: map.description_field,
        type_value_whatsapp: map.type_value_whatsapp,
      },
      last_writeback_at: ranAt,
      last_writeback_result: `ok · ${written} written · ${skipped} skipped · ${failed} failed`,
    };
    await supabase
      .from("channels")
      .update({ config: nextCfg, updated_at: ranAt })
      .eq("org_id", ORG_ID)
      .eq("type", "brainmine");
  } catch {
    /* non-fatal */
  }

  return {
    written,
    skipped,
    failed,
    updatedSummaries,
    errors: errors.slice(0, 12),
    ranAt,
  };
}

export const writeBrainmineFollowUpsNow = createServerFn({ method: "POST" }).handler(async () => {
  return runBrainmineFollowUpWriteback();
});

/** Refresh local follow_up_summary only (no CRM write) — optional helper for Leads display. */
export const refreshLeadFollowUpSummaries = createServerFn({ method: "POST" }).handler(async () => {
  const supabase = createServiceSupabase();
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, metadata")
    .eq("org_id", ORG_ID)
    .eq("source", "brainmine")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  let updated = 0;
  for (const lead of leads || []) {
    const { data: convo } = await supabase
      .from("conversations")
      .select("id")
      .eq("org_id", ORG_ID)
      .eq("lead_id", lead.id)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!convo) continue;
    const { data: messages } = await supabase
      .from("messages")
      .select("sender, body")
      .eq("conversation_id", convo.id)
      .order("created_at", { ascending: false })
      .limit(16);
    const summary = buildConversationSummary(
      [...(messages || [])].reverse().map((m) => ({
        sender: String(m.sender),
        body: String(m.body || ""),
      })),
    );
    if (!summary) continue;
    const meta = {
      ...((lead.metadata && typeof lead.metadata === "object" ? lead.metadata : {}) as Record<
        string,
        unknown
      >),
      follow_up_summary: summary,
    };
    await supabase.from("leads").update({ metadata: meta }).eq("id", lead.id);
    updated += 1;
  }
  return { updated };
});
