/**
 * Brainmine Follow Up write-back — SEPARATE from lead sync.
 *
 * Sync (brainmine.ts) stays GET-only into Engage /leads.
 * This module only appends Follow Up Activity rows on a CRM Lead/Opportunity
 * when staff clicks the manual “Write follow-ups to Brainmine” button.
 *
 * Field mapping (locked with product):
 * - Follow up type → Whatsapp (Brainmine Select option; not "WhatsApp")
 * - Contact with → CRM Contact Link: match phone (1st) → email → company → person name; omit if none
 * - Next Follow Up Date → push date + 4 days
 * - Description → conversation summary
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
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
  type_value_whatsapp: "Whatsapp",
};

const TABLE_CANDIDATES = [
  "follow_up_details",
  "follow_up_activity",
  "follow_up_activity_table",
  "custom_follow_up_details",
  "custom_follow_up_activity",
  "custom_follow_up_activity_table",
  "followups",
  "follow_ups",
  "follow_up",
];

function scoreFollowUpTableName(key: string): number {
  const k = key.toLowerCase();
  let score = 0;
  if (/follow/.test(k)) score += 5;
  if (/activit/.test(k)) score += 2;
  if (/detail/.test(k)) score += 1;
  if (/custom_/.test(k)) score += 1;
  return score;
}

function scoreColumnKey(key: string): { role: keyof WritebackMap | null; score: number } {
  const k = key.toLowerCase();
  if (/follow.?up.?type|type/.test(k) && /follow|type/.test(k)) {
    if (/type/.test(k)) return { role: "type_field", score: /follow/.test(k) ? 8 : 3 };
  }
  if (/contact/.test(k)) return { role: "contact_field", score: 8 };
  if (/next/.test(k) && /date|follow/.test(k)) return { role: "next_date_field", score: 8 };
  if (/follow.?up.?date/.test(k)) return { role: "next_date_field", score: 7 };
  if (/desc/.test(k)) return { role: "description_field", score: 8 };
  if (/^type$/.test(k)) return { role: "type_field", score: 4 };
  return { role: null, score: 0 };
}

function detectFollowUpTable(doc: Record<string, unknown>, preferred: string): string | null {
  if (Array.isArray(doc[preferred])) return preferred;
  for (const key of TABLE_CANDIDATES) {
    if (Array.isArray(doc[key])) return key;
  }
  const scored: Array<{ key: string; score: number }> = [];
  for (const [key, value] of Object.entries(doc)) {
    if (!Array.isArray(value)) continue;
    const nameScore = scoreFollowUpTableName(key);
    if (nameScore < 5) continue;
    const first = value[0];
    let colScore = 0;
    if (first && typeof first === "object" && !Array.isArray(first)) {
      for (const col of Object.keys(first as Record<string, unknown>)) {
        colScore += scoreColumnKey(col).score;
      }
    }
    scored.push({ key, score: nameScore + colScore });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored[0]?.score) return scored[0].key;

  // Empty child tables: Frappe often omits them from GET — preferred / candidates still usable on PUT
  if (Object.prototype.hasOwnProperty.call(doc, preferred)) return preferred;
  for (const key of TABLE_CANDIDATES) {
    if (Object.prototype.hasOwnProperty.call(doc, key)) return key;
  }
  return preferred || null;
}

function resolveWritebackMap(cfg: BrainmineChannelConfig): WritebackMap {
  const w = cfg.writeback || {};
  // Brainmine Select options: Phone | Whatsapp | Email (exact casing — not "WhatsApp")
  const rawType = w.type_value_whatsapp?.trim() || DEFAULT_MAP.type_value_whatsapp;
  const typeValue =
    /^whatsapp$/i.test(rawType) ? "Whatsapp" : rawType;
  return {
    follow_up_table: w.follow_up_table?.trim() || DEFAULT_MAP.follow_up_table,
    type_field: w.type_field?.trim() || DEFAULT_MAP.type_field,
    contact_field: w.contact_field?.trim() || DEFAULT_MAP.contact_field,
    next_date_field: w.next_date_field?.trim() || DEFAULT_MAP.next_date_field,
    description_field: w.description_field?.trim() || DEFAULT_MAP.description_field,
    type_value_whatsapp: typeValue,
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

/** Digits only, prefer last 10 for IN mobile match. */
function phoneDigits(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length >= 10) return d.slice(-10);
  return d;
}

/**
 * Contact with is a Link field in Brainmine — value must be an existing Contact name.
 * Match priority: WhatsApp/phone → email → company → person name (visitor / lead).
 */
async function findContactByFilter(
  cfg: BrainmineChannelConfig,
  filters: unknown[],
): Promise<string | null> {
  try {
    const json = await brainmineHttpJson(
      cfg,
      `/api/resource/Contact?limit_page_length=5&fields=${encodeURIComponent(
        JSON.stringify([
          "name",
          "first_name",
          "last_name",
          "mobile_no",
          "phone",
          "email_id",
          "company_name",
        ]),
      )}&filters=${encodeURIComponent(JSON.stringify(filters))}`,
      { method: "GET" },
    );
    const hit = extractRows(json)[0];
    if (hit && typeof hit.name === "string" && hit.name.trim()) {
      return hit.name.trim();
    }
  } catch {
    /* API user may lack Contact read — try next matcher */
  }
  return null;
}

async function resolveWhatsAppContactLink(
  cfg: BrainmineChannelConfig,
  options: {
    phone?: string | null;
    email?: string | null;
    company?: string | null;
    visitorName?: string | null;
    leadName?: string | null;
  },
): Promise<{ contactName: string; matchedBy: string } | null> {
  const phone = phoneDigits(options.phone);
  const email = String(options.email || "")
    .trim()
    .toLowerCase();
  const company = String(options.company || "").trim();
  const visitor = String(options.visitorName || "").trim();
  const leadName = String(options.leadName || "").trim();

  // 1) Phone (highest priority) — WhatsApp / mobile / phone
  if (phone.length >= 8) {
    for (const field of ["mobile_no", "phone"] as const) {
      const name = await findContactByFilter(cfg, [[field, "like", `%${phone}%`]]);
      if (name) return { contactName: name, matchedBy: `phone:${field}` };
    }
  }

  // 2) Email
  if (email.includes("@")) {
    const name = await findContactByFilter(cfg, [["email_id", "=", email]]);
    if (name) return { contactName: name, matchedBy: "email" };
    const nameLike = await findContactByFilter(cfg, [["email_id", "like", `%${email}%`]]);
    if (nameLike) return { contactName: nameLike, matchedBy: "email" };
  }

  // 3) Company name (Contact.company_name — not the Contact Link name itself)
  if (company.length >= 2) {
    const name = await findContactByFilter(cfg, [["company_name", "=", company]]);
    if (name) return { contactName: name, matchedBy: "company" };
    const nameLike = await findContactByFilter(cfg, [
      ["company_name", "like", `%${company.slice(0, 40)}%`],
    ]);
    if (nameLike) return { contactName: nameLike, matchedBy: "company" };
  }

  // 4) Person names — WhatsApp visitor, then lead contact name
  for (const [label, person] of [
    ["visitor", visitor],
    ["lead_name", leadName],
  ] as const) {
    if (!person || person.length < 2) continue;
    // Exact Contact name (Frappe Link uses name)
    const byName = await findContactByFilter(cfg, [["name", "=", person]]);
    if (byName) return { contactName: byName, matchedBy: label };
    const byFirst = await findContactByFilter(cfg, [["first_name", "=", person]]);
    if (byFirst) return { contactName: byFirst, matchedBy: label };
    // Partial on full name when CRM stores "First Last"
    const byLike = await findContactByFilter(cfg, [["name", "like", `%${person.slice(0, 40)}%`]]);
    if (byLike) return { contactName: byLike, matchedBy: label };
  }

  return null;
}

async function appendFollowUpRow(options: {
  cfg: BrainmineChannelConfig;
  docName: string;
  map: WritebackMap;
  /** CRM Contact Link name — omit when null (avoids LinkValidationError). */
  contactLink: string | null;
  summary: string;
  followUpType: string;
}): Promise<{ table: string; rowCount: number }> {
  const { cfg, docName, map, contactLink, summary, followUpType } = options;
  const doc = await fetchCrmDoc(cfg, docName);
  const table = detectFollowUpTable(doc, map.follow_up_table);
  if (!table) {
    throw new Error(
      `Could not find Follow Up child table on CRM doc ${docName}. ` +
        `Run “Inspect write-back fields” on Channels to discover the table fieldname, then Save mapping.`,
    );
  }

  const existing = Array.isArray(doc[table]) ? [...(doc[table] as Record<string, unknown>[])] : [];
  const sample =
    existing.find((r) => r && typeof r === "object") || (null as Record<string, unknown> | null);

  // Prefer real column names from an existing Follow Up row (Brainmine UI labels ≠ API fieldnames)
  const col = (preferred: string, patterns: RegExp[]) => {
    if (sample && Object.prototype.hasOwnProperty.call(sample, preferred)) return preferred;
    if (sample) {
      for (const key of Object.keys(sample)) {
        if (patterns.some((re) => re.test(key))) return key;
      }
    }
    return preferred;
  };
  const typeField = col(map.type_field, [/follow.?up.?type|^type$/i]);
  const contactField = col(map.contact_field, [/contact/i]);
  const nextDateField = col(map.next_date_field, [/next.*date|follow.?up.?date/i]);
  const descField = col(map.description_field, [/desc/i]);

  const nextDate = ymdPlusDays(FOLLOW_UP_DAYS);
  const row: Record<string, unknown> = {
    [typeField]: followUpType,
    [nextDateField]: nextDate,
    [descField]: summary,
  };
  if (contactLink) {
    row[contactField] = contactLink;
  }
  existing.push(row);

  // Minimal PUT — full doc dumps often ignore / strip child tables on custom Brainmine
  const payload: Record<string, unknown> = {
    name: doc.name || docName,
    [table]: existing,
  };

  await brainmineHttpJson(cfg, `${leadsPath(cfg)}/${encodeURIComponent(docName)}`, {
    method: "PUT",
    body: payload,
  });

  // Verify the Description landed on CRM (catch silent no-ops)
  const after = await fetchCrmDoc(cfg, docName);
  const afterRows = Array.isArray(after[table]) ? (after[table] as Record<string, unknown>[]) : [];
  if (afterRows.length < existing.length) {
    throw new Error(
      `CRM accepted write but Follow Up row count did not increase on ${docName} (table ${table}). ` +
        `Re-run Inspect write-back fields and confirm the table fieldname.`,
    );
  }
  const last = afterRows[afterRows.length - 1] || {};
  const descVal = String(last[descField] ?? last[map.description_field] ?? "").trim();
  if (!descVal) {
    throw new Error(
      `Follow Up row saved on ${docName} but Description is empty (tried field “${descField}”). ` +
        `Open Inspect write-back fields, set Description fieldname from child table columns, Save mapping.`,
    );
  }

  return { table, rowCount: afterRows.length };
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
    .select(
      "id, name, company, phone, email, notes, source, external_ref, metadata, next_follow_up_at",
    )
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
    return Boolean(String(meta.brainmine_id || l.external_ref || "").trim());
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
    const brainmineId = String(meta.brainmine_id || lead.external_ref || "").trim();
    if (!brainmineId) {
      skipped += 1;
      continue;
    }

    const { data: convos } = await supabase
      .from("conversations")
      .select("id, channel, visitor_name, visitor_phone, preview, last_message_at")
      .eq("org_id", ORG_ID)
      .eq("lead_id", lead.id)
      .order("last_message_at", { ascending: false })
      .limit(8);

    const waConvo = (convos || []).find((c) => c.channel === "whatsapp") || null;
    const anyConvo = waConvo || (convos || [])[0] || null;

    let summary = "";
    if (anyConvo) {
      const { data: messages } = await supabase
        .from("messages")
        .select("sender, body, created_at")
        .eq("conversation_id", anyConvo.id)
        .order("created_at", { ascending: false })
        .limit(16);
      const chronological = [...(messages || [])].reverse();
      summary = buildConversationSummary(
        chronological.map((m) => ({ sender: String(m.sender), body: String(m.body || "") })),
      );
    }

    // Fallback for leads without chat (e.g. dummy test note) — still write to Brainmine
    if (!summary) {
      const localSummary =
        typeof meta.follow_up_summary === "string" ? meta.follow_up_summary.trim() : "";
      const notes = typeof lead.notes === "string" ? lead.notes.trim() : "";
      summary = localSummary || notes;
    }

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

    const waPhone = waConvo?.visitor_phone || lead.phone || null;
    const matched = await resolveWhatsAppContactLink(cfg, {
      phone: waPhone,
      email: lead.email,
      company: lead.company,
      visitorName: waConvo?.visitor_name || anyConvo?.visitor_name,
      leadName: lead.name,
    });
    const contactLink = matched?.contactName || null;
    const followUpType = map.type_value_whatsapp;
    const description = summary;

    try {
      const result = await appendFollowUpRow({
        cfg,
        docName: brainmineId,
        map,
        contactLink,
        summary: description,
        followUpType,
      });
      if (matched) {
        meta.brainmine_followup_contact = matched.contactName;
        meta.brainmine_followup_contact_matched_by = matched.matchedBy;
      }
      meta.brainmine_followup_written_at = ranAt;
      meta.brainmine_followup_summary_hash = summary.slice(0, 120);
      meta.brainmine_followup_next_date = ymdPlusDays(FOLLOW_UP_DAYS);
      meta.brainmine_followup_table = result.table;
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
      errors.push(`${lead.name || lead.company || lead.id} (${brainmineId}): ${msg}`);
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

function doctypeFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "resource");
  const raw = idx >= 0 ? parts[idx + 1] : parts[parts.length - 1];
  return decodeURIComponent(raw || "Lead");
}

function extractRows(json: unknown): Record<string, unknown>[] {
  const data = getByPath(json, "data");
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  return [];
}

function previewCell(v: unknown, max = 80): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    const s = String(v);
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }
  try {
    const s = JSON.stringify(v);
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  } catch {
    return "[object]";
  }
}

function inferMapFromColumns(columns: string[]): WritebackMap {
  const map = { ...DEFAULT_MAP };
  const picks: Partial<Record<keyof WritebackMap, { key: string; score: number }>> = {};
  for (const col of columns) {
    const { role, score } = scoreColumnKey(col);
    if (!role || role === "follow_up_table" || role === "type_value_whatsapp") continue;
    const prev = picks[role];
    if (!prev || score > prev.score) picks[role] = { key: col, score };
  }
  if (picks.type_field) map.type_field = picks.type_field.key;
  if (picks.contact_field) map.contact_field = picks.contact_field.key;
  if (picks.next_date_field) map.next_date_field = picks.next_date_field.key;
  if (picks.description_field) map.description_field = picks.description_field.key;
  return map;
}

/**
 * Read-only discovery for Follow Up write-back: child tables on sample CRM doc +
 * DocField/Custom Field Table fields. Use Save mapping after picking the right table.
 */
export const inspectBrainmineWritebackFields = createServerFn({ method: "POST" }).handler(
  async () => {
    const cfg = await loadBrainmineConfig();
    if (!brainmineConfigReady(cfg)) {
      throw new Error("Configure Brainmine API base URL and API key under Channels first.");
    }
    const path = leadsPath(cfg);
    const doctype = doctypeFromPath(path);
    const currentMap = resolveWritebackMap(cfg);

    // Prefer a Brainmine lead id we already synced (Opportunity names like CRM-OPP-…)
    const supabase = createServiceSupabase();
    const { data: localLeads } = await supabase
      .from("leads")
      .select("name, metadata, external_ref")
      .eq("org_id", ORG_ID)
      .eq("source", "brainmine")
      .order("updated_at", { ascending: false })
      .limit(8);

    const candidateIds: string[] = [];
    for (const lead of localLeads || []) {
      const meta =
        lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata)
          ? (lead.metadata as Record<string, unknown>)
          : {};
      const bmId =
        (typeof meta.brainmine_id === "string" && meta.brainmine_id) ||
        (typeof lead.external_ref === "string" && lead.external_ref) ||
        "";
      if (bmId && !candidateIds.includes(bmId)) candidateIds.push(bmId);
    }

    // Also list latest CRM docs
    try {
      const listJson = await brainmineHttpJson(
        cfg,
        `${path}?limit_page_length=5&order_by=${encodeURIComponent("modified desc")}&fields=${encodeURIComponent(JSON.stringify(["name"]))}`,
        { method: "GET" },
      );
      for (const row of extractRows(listJson)) {
        const id = typeof row.name === "string" ? row.name : "";
        if (id && !candidateIds.includes(id)) candidateIds.push(id);
      }
    } catch {
      /* list optional if we have local ids */
    }

    if (!candidateIds.length) {
      throw new Error("No Brainmine CRM documents found to inspect. Sync at least one lead first.");
    }

    type ChildTableInfo = {
      key: string;
      rowCount: number;
      columns: string[];
      sampleRowPreview: string;
      score: number;
      presentOnDoc: boolean;
    };

    let sampleId = candidateIds[0];
    let sampleDoc: Record<string, unknown> = {};
    let childTables: ChildTableInfo[] = [];
    let bestScore = -1;

    for (const id of candidateIds.slice(0, 6)) {
      try {
        const doc = await fetchCrmDoc(cfg, id);
        const tables: ChildTableInfo[] = [];
        for (const [key, value] of Object.entries(doc)) {
          if (key.startsWith("_")) continue;
          if (!Array.isArray(value)) continue;
          const rows = value as unknown[];
          const first =
            rows.find((r) => r && typeof r === "object" && !Array.isArray(r)) || null;
          const columns =
            first && typeof first === "object"
              ? Object.keys(first as Record<string, unknown>).filter((k) => !k.startsWith("_"))
              : [];
          const nameScore = scoreFollowUpTableName(key);
          let colScore = 0;
          for (const col of columns) colScore += scoreColumnKey(col).score;
          tables.push({
            key,
            rowCount: rows.length,
            columns,
            sampleRowPreview: first ? previewCell(first, 200) : "(empty table)",
            score: nameScore + colScore,
            presentOnDoc: true,
          });
        }
        const top = [...tables].sort((a, b) => b.score - a.score)[0];
        const topScore = top?.score ?? 0;
        if (topScore > bestScore || !Object.keys(sampleDoc).length) {
          bestScore = topScore;
          sampleId = id;
          sampleDoc = doc;
          childTables = tables.sort((a, b) => b.score - a.score);
          if (topScore >= 10) break;
        }
      } catch {
        /* try next id */
      }
    }

    if (!Object.keys(sampleDoc).length) {
      throw new Error(`Could not load CRM document ${candidateIds[0]} for write-back inspect.`);
    }

    // DocField / Custom Field — Table fields (Follow Up Activity Table, etc.)
    type MetaTable = {
      fieldname: string;
      label: string;
      fieldtype: string;
      options: string;
      source: "doctype" | "custom";
      looksLikeFollowUp: boolean;
    };
    const metaTables: MetaTable[] = [];
    let metaError: string | null = null;

    const pushMeta = (
      rows: Record<string, unknown>[],
      source: "doctype" | "custom",
    ) => {
      for (const r of rows) {
        const fieldtype = String(r.fieldtype || "");
        if (!/table/i.test(fieldtype)) continue;
        const fieldname = String(r.fieldname || "");
        const label = String(r.label || "");
        if (!fieldname) continue;
        const looksLikeFollowUp =
          /follow/i.test(fieldname) || /follow/i.test(label) || /activit/i.test(label);
        metaTables.push({
          fieldname,
          label,
          fieldtype,
          options: String(r.options || ""),
          source,
          looksLikeFollowUp,
        });
      }
    };

    try {
      const metaJson = await brainmineHttpJson(
        cfg,
        `/api/resource/DocField?limit_page_length=500&fields=${encodeURIComponent(
          JSON.stringify(["fieldname", "label", "fieldtype", "options"]),
        )}&filters=${encodeURIComponent(JSON.stringify([["parent", "=", doctype]]))}`,
        { method: "GET" },
      );
      pushMeta(extractRows(metaJson), "doctype");
    } catch (err) {
      metaError = err instanceof Error ? err.message : "DocField meta unavailable";
    }

    try {
      const customJson = await brainmineHttpJson(
        cfg,
        `/api/resource/Custom%20Field?limit_page_length=200&fields=${encodeURIComponent(
          JSON.stringify(["fieldname", "label", "fieldtype", "options", "dt"]),
        )}&filters=${encodeURIComponent(JSON.stringify([["dt", "=", doctype]]))}`,
        { method: "GET" },
      );
      pushMeta(extractRows(customJson), "custom");
    } catch (err) {
      if (!metaError) {
        metaError = err instanceof Error ? err.message : "Custom Field meta unavailable";
      }
    }

    const followMeta = metaTables
      .filter((m) => m.looksLikeFollowUp)
      .sort((a, b) => a.fieldname.localeCompare(b.fieldname));

    // Recommended table: best child on sample, else first follow meta field
    const bestChild = childTables.find((t) => t.score >= 5) || childTables[0] || null;
    const recommendedTable =
      bestChild?.key ||
      followMeta[0]?.fieldname ||
      currentMap.follow_up_table;

    const recommendedColumns =
      bestChild?.columns?.length
        ? bestChild.columns
        : [];
    const recommendedMap: WritebackMap = {
      ...inferMapFromColumns(recommendedColumns),
      follow_up_table: recommendedTable,
      type_value_whatsapp: currentMap.type_value_whatsapp,
    };

    // All top-level keys for debugging (like lead inspect)
    const allKeys = Object.keys(sampleDoc)
      .filter((k) => !k.startsWith("_"))
      .sort((a, b) => a.localeCompare(b))
      .map((key) => {
        const value = sampleDoc[key];
        const isArray = Array.isArray(value);
        return {
          key,
          kind: isArray ? "child_table" : typeof value,
          preview: isArray
            ? `array(${(value as unknown[]).length})`
            : previewCell(value, 100),
        };
      });

    let diagnosis: string;
    if (bestChild && bestChild.score >= 8) {
      diagnosis = `Likely Follow Up table on sample: “${bestChild.key}” (${bestChild.rowCount} row(s)). Save mapping, then re-run Write follow-ups.`;
    } else if (followMeta.length) {
      diagnosis = `Sample doc has no follow-up rows in the API response (empty child tables are often omitted). Meta suggests table fieldname “${followMeta[0].fieldname}” (${followMeta[0].label || "no label"}). Save that mapping and retry write-back.`;
    } else if (childTables.length) {
      diagnosis =
        "No strong Follow Up match. Pick a child table below that matches Brainmine’s Follow Up Activity Table, Save mapping, then retry.";
    } else {
      diagnosis =
        "No child tables returned on the sample document and no Follow-related Table fields in DocType meta. Ask Brainmine for the exact child table fieldname (API fieldname, not the UI label), or grant the API user permission to read that table.";
    }

    return {
      sampleId,
      doctype,
      leadsPath: path,
      currentMap,
      recommendedMap,
      diagnosis,
      hint: "Write-back is separate from lead sync. Save the Follow Up child table fieldname here, then use Write follow-ups to Brainmine.",
      childTables,
      followUpMetaTables: followMeta,
      allMetaTables: metaTables,
      metaError,
      allKeys,
    };
  },
);

export const saveBrainmineWritebackMap = createServerFn({ method: "POST" })
  .validator(
    z.object({
      follow_up_table: z.string().min(1).max(120),
      type_field: z.string().min(1).max(120).optional(),
      contact_field: z.string().min(1).max(120).optional(),
      next_date_field: z.string().min(1).max(120).optional(),
      description_field: z.string().min(1).max(120).optional(),
      type_value_whatsapp: z.string().min(1).max(80).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const cfg = await loadBrainmineConfig();
    if (!brainmineConfigReady(cfg)) {
      throw new Error("Configure Brainmine credentials first.");
    }
    const supabase = createServiceSupabase();
    const nextCfg: BrainmineChannelConfig = {
      ...cfg,
      writeback: {
        ...(cfg.writeback || {}),
        follow_up_table: data.follow_up_table.trim(),
        type_field: (data.type_field || DEFAULT_MAP.type_field).trim(),
        contact_field: (data.contact_field || DEFAULT_MAP.contact_field).trim(),
        next_date_field: (data.next_date_field || DEFAULT_MAP.next_date_field).trim(),
        description_field: (data.description_field || DEFAULT_MAP.description_field).trim(),
        type_value_whatsapp: (data.type_value_whatsapp || DEFAULT_MAP.type_value_whatsapp).trim(),
      },
    };
    const { error } = await supabase
      .from("channels")
      .update({ config: nextCfg, updated_at: new Date().toISOString() })
      .eq("org_id", ORG_ID)
      .eq("type", "brainmine");
    if (error) throw new Error(error.message);
    return { ok: true as const, writeback: nextCfg.writeback };
  });
