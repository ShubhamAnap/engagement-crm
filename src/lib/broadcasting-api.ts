import { getBrowserSupabase } from "@/lib/supabase";
import { ENERTECH_ORG_ID } from "@/lib/chat-api";
import {
  runWhatsAppBroadcast,
  submitWhatsAppTemplateToMeta,
  syncWhatsAppTemplatesFromMeta,
  previewWhatsAppTemplateSync,
  countTemplateVars,
  sendInboxWhatsAppTemplate,
} from "@/server/whatsapp-broadcast";
import {
  analyzeWaTemplateFromRow,
  isPublicHttpUrl,
} from "@/lib/wa-template-params";

export { analyzeWaTemplateFromRow, isPublicHttpUrl } from "@/lib/wa-template-params";

export type WaTemplateStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED";

export type BroadcastStatus =
  | "Draft"
  | "Queued"
  | "Sending"
  | "Completed"
  | "Failed"
  | "Cancelled";

export type DbWaTemplate = {
  id: string;
  org_id: string;
  channel_type: string;
  name: string;
  language: string;
  category: string;
  status: WaTemplateStatus;
  body_text: string;
  header_text: string | null;
  footer_text: string | null;
  components: unknown[];
  meta_id: string | null;
  rejection_reason: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DbBroadcast = {
  id: string;
  org_id: string;
  channel_type: string;
  name: string;
  status: BroadcastStatus;
  template_id: string | null;
  template_name: string | null;
  template_language: string | null;
  subject?: string | null;
  body_text?: string | null;
  body_format?: string | null;
  variable_values: string[];
  audience: Record<string, unknown>;
  total_count: number;
  sent_count: number;
  failed_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AudienceKind =
  | "customers_with_phone"
  | "leads_with_phone"
  | "indiamart_leads"
  | "manual"
  | "customers_with_email"
  | "leads_with_email"
  | "manual_emails"
  | "upload_csv";

export { countTemplateVars, syncWhatsAppTemplatesFromMeta, previewWhatsAppTemplateSync, submitWhatsAppTemplateToMeta, runWhatsAppBroadcast, sendInboxWhatsAppTemplate };

export type EmailUploadRecipient = {
  email: string;
  name?: string | null;
  mergeFields?: Record<string, string | null | undefined>;
};

function waTemplateStatusRank(status: string): number {
  switch (String(status).toUpperCase()) {
    case "APPROVED":
      return 0;
    case "PENDING":
      return 1;
    case "DRAFT":
      return 2;
    case "PAUSED":
      return 3;
    case "REJECTED":
      return 4;
    case "DISABLED":
      return 5;
    default:
      return 6;
  }
}

function waTemplateActivityMs(t: DbWaTemplate): number {
  return Math.max(
    t.updated_at ? new Date(t.updated_at).getTime() : 0,
    t.created_at ? new Date(t.created_at).getTime() : 0,
  );
}

function waTemplateMetaId(t: DbWaTemplate): bigint {
  try {
    return BigInt(t.meta_id || "0");
  } catch {
    return BigInt(0);
  }
}

/** Approved templates first, then newest Meta update/approval on top. */
export function sortWaTemplates(rows: DbWaTemplate[]): DbWaTemplate[] {
  return rows.slice().sort((a, b) => {
    const rankDiff = waTemplateStatusRank(a.status) - waTemplateStatusRank(b.status);
    if (rankDiff !== 0) return rankDiff;

    const activityDiff = waTemplateActivityMs(b) - waTemplateActivityMs(a);
    if (activityDiff !== 0) return activityDiff;

    const metaA = waTemplateMetaId(a);
    const metaB = waTemplateMetaId(b);
    if (metaB > metaA) return 1;
    if (metaB < metaA) return -1;

    return a.name.localeCompare(b.name);
  });
}

export async function createAndSendEmailBroadcast(options: {
  orgId?: string;
  name: string;
  subject: string;
  body: string;
  format: "text" | "html";
  audienceKind: AudienceKind;
  manualEmails?: string[];
  /** Campaign-only CSV rows (audienceKind = upload_csv). Not saved as leads. */
  uploadedRecipients?: EmailUploadRecipient[];
  createdBy?: string | null;
  /** Random pause between each Gmail send (seconds). Default 4–12. */
  delayMinSec?: number;
  delayMaxSec?: number;
}) {
  const orgId = options.orgId ?? ENERTECH_ORG_ID;
  type ResolvedEmail = {
    email: string;
    name: string | null;
    customer_id?: string;
    lead_id?: string;
    merge_fields?: Record<string, string | null | undefined> | null;
  };

  let recipients: ResolvedEmail[];
  if (options.audienceKind === "upload_csv") {
    const uploaded = options.uploadedRecipients || [];
    const seen = new Set<string>();
    recipients = [];
    for (const row of uploaded) {
      const email = (row.email || "").trim().toLowerCase();
      if (!email.includes("@") || seen.has(email)) continue;
      seen.add(email);
      recipients.push({
        email,
        name: row.name?.trim() || null,
        merge_fields: row.mergeFields || { email, name: row.name || null },
      });
    }
  } else {
    recipients = await resolveAudienceEmails(
      orgId,
      options.audienceKind,
      options.manualEmails || [],
    );
  }
  if (!recipients.length) throw new Error("No recipients with email found for this audience");

  let delayMinSec = Math.round(Number(options.delayMinSec ?? 4));
  let delayMaxSec = Math.round(Number(options.delayMaxSec ?? 12));
  if (!Number.isFinite(delayMinSec) || delayMinSec < 0) delayMinSec = 0;
  if (!Number.isFinite(delayMaxSec) || delayMaxSec < delayMinSec) delayMaxSec = delayMinSec;
  if (delayMinSec > 120) delayMinSec = 120;
  if (delayMaxSec > 300) delayMaxSec = 300;

  const mergeByEmail: Record<string, Record<string, string | null | undefined>> = {};
  for (const r of recipients) {
    if (r.merge_fields) mergeByEmail[r.email] = r.merge_fields;
  }

  const supabase = getBrowserSupabase();
  const { data: broadcast, error } = await supabase
    .from("broadcasts")
    .insert({
      org_id: orgId,
      channel_type: "email",
      name: options.name.trim(),
      status: "Queued",
      subject: options.subject.trim(),
      body_text: options.body,
      body_format: options.format,
      variable_values: [],
      audience: {
        kind: options.audienceKind,
        delay_min_sec: delayMinSec,
        delay_max_sec: delayMaxSec,
        ...(Object.keys(mergeByEmail).length ? { merge_by_email: mergeByEmail } : {}),
      },
      total_count: recipients.length,
      created_by: options.createdBy || null,
    })
    .select("*")
    .single();
  if (error) throw error;

  const baseRows = recipients.map((r) => ({
    org_id: orgId,
    broadcast_id: broadcast.id,
    phone: null as string | null,
    email: r.email,
    name: r.name,
    customer_id: r.customer_id || null,
    lead_id: r.lead_id || null,
    status: "pending",
  }));

  // Prefer storing merge_fields per recipient when migration 020 is applied.
  // If the column is missing, fall back — audience.merge_by_email still personalizes.
  const withMerge = baseRows.map((row, i) => ({
    ...row,
    merge_fields: recipients[i].merge_fields || null,
  }));

  let recErr = (await supabase.from("broadcast_recipients").insert(withMerge)).error;
  if (recErr && /merge_fields/i.test(recErr.message || "")) {
    recErr = (await supabase.from("broadcast_recipients").insert(baseRows)).error;
  }
  if (recErr) {
    // Clean up orphan broadcast so UI doesn't show a dead Queued campaign
    await supabase.from("broadcasts").delete().eq("id", broadcast.id);
    throw new Error(
      /merge_fields/i.test(recErr.message || "")
        ? "Recipient save failed. Run migration 020_broadcast_recipient_merge.sql in Supabase, then retry."
        : recErr.message || "Failed to save campaign recipients",
    );
  }

  const { runGmailEmailBroadcast } = await import("@/server/gmail-api");
  const result = await runGmailEmailBroadcast({ data: { broadcastId: broadcast.id as string } });
  return {
    broadcastId: broadcast.id as string,
    delayMinSec,
    delayMaxSec,
    ...result,
  };
}

async function resolveAudienceEmails(
  orgId: string,
  kind: AudienceKind,
  manualEmails: string[],
): Promise<Array<{ email: string; name: string | null; customer_id?: string; lead_id?: string }>> {
  const supabase = getBrowserSupabase();
  const out: Array<{ email: string; name: string | null; customer_id?: string; lead_id?: string }> = [];
  const seen = new Set<string>();

  const push = (
    email: string | null | undefined,
    name: string | null,
    ids?: { customer_id?: string; lead_id?: string },
  ) => {
    const addr = (email || "").trim().toLowerCase();
    if (!addr.includes("@") || seen.has(addr)) return;
    seen.add(addr);
    out.push({ email: addr, name, ...ids });
  };

  if (kind === "manual_emails" || kind === "manual") {
    for (const line of manualEmails) {
      for (const part of line.split(/[,;\s]+/)) push(part, null);
    }
    return out;
  }

  if (kind === "customers_with_email") {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, email, company, phone, notes")
      .eq("org_id", orgId)
      .not("email", "is", null)
      .limit(500);
    if (error) throw error;
    for (const c of data ?? []) push(c.email as string, c.name as string, { customer_id: c.id as string });
    return out;
  }

  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, name, email, company, phone, requirement, sales_person, location, source, status, notes",
    )
    .eq("org_id", orgId)
    .not("email", "is", null)
    .limit(500);
  if (error) throw error;
  for (const l of data ?? []) {
    if (kind === "indiamart_leads" && l.source !== "indiamart") continue;
    push(l.email as string, l.name as string, { lead_id: l.id as string });
  }
  return out;
}

export async function listWaTemplates(orgId: string = ENERTECH_ORG_ID): Promise<DbWaTemplate[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("wa_message_templates")
    .select("*")
    .eq("org_id", orgId)
    .eq("channel_type", "whatsapp")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return sortWaTemplates((data ?? []) as DbWaTemplate[]);
}

export async function listBroadcasts(orgId: string = ENERTECH_ORG_ID): Promise<DbBroadcast[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...(row as DbBroadcast),
    variable_values: Array.isArray(row.variable_values) ? (row.variable_values as string[]) : [],
    audience: (row.audience || {}) as Record<string, unknown>,
  }));
}

export async function listBroadcastRecipients(broadcastId: string) {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("broadcast_recipients")
    .select("id, phone, email, name, status, error, sent_at")
    .eq("broadcast_id", broadcastId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

type PhoneAudienceRow = {
  phone: string;
  name: string | null;
  customer_id?: string;
  lead_id?: string;
  merge_fields?: Record<string, string | null | undefined> | null;
};

async function resolveAudiencePhones(
  orgId: string,
  kind: AudienceKind,
  manualPhones: string[],
  leadFilters?: import("@/lib/broadcast-audience-filters").BroadcastLeadFilter[],
): Promise<PhoneAudienceRow[]> {
  const supabase = getBrowserSupabase();
  const { mergeFieldsFromCustomerRow, mergeFieldsFromLeadRow } = await import(
    "@/lib/wa-template-merge"
  );
  const { leadMatchesBroadcastFilters } = await import("@/lib/broadcast-audience-filters");
  const out: PhoneAudienceRow[] = [];
  const seen = new Set<string>();

  let salesDirectory: Array<{ email: string; display_name: string; is_active: boolean }> = [];
  if (leadFilters?.some((f) => f.field === "sales_person" && String(f.value || "").trim())) {
    const { data: dirRows } = await supabase
      .from("sales_person_directory")
      .select("email, display_name, is_active")
      .eq("org_id", orgId)
      .eq("is_active", true);
    salesDirectory = (dirRows || []) as typeof salesDirectory;
  }

  const push = (
    phone: string | null | undefined,
    name: string | null,
    ids?: { customer_id?: string; lead_id?: string },
    merge_fields?: Record<string, string | null | undefined> | null,
  ) => {
    const digits = (phone || "").replace(/\D/g, "");
    if (digits.length < 8 || seen.has(digits)) return;
    seen.add(digits);
    out.push({ phone: digits, name, ...ids, merge_fields: merge_fields || null });
  };

  if (kind === "manual") {
    for (const line of manualPhones) push(line, null);
    return out;
  }

  if (kind === "customers_with_phone") {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, phone, email, company, notes")
      .eq("org_id", orgId)
      .not("phone", "is", null)
      .limit(500);
    if (error) throw error;
    for (const c of data ?? []) {
      push(c.phone as string, c.name as string, { customer_id: c.id as string }, mergeFieldsFromCustomerRow(c));
    }
    return out;
  }

  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, name, phone, email, company, requirement, sales_person, location, source, status, notes",
    )
    .eq("org_id", orgId)
    .not("phone", "is", null)
    .limit(2000);
  if (error) throw error;
  for (const l of data ?? []) {
    if (kind === "indiamart_leads" && l.source !== "indiamart") continue;
    if (!leadMatchesBroadcastFilters(l as Record<string, unknown>, leadFilters, salesDirectory))
      continue;
    push(l.phone as string, l.name as string, { lead_id: l.id as string }, mergeFieldsFromLeadRow(l));
  }
  return out;
}

export async function createAndSendBroadcast(options: {
  orgId?: string;
  name: string;
  template: DbWaTemplate;
  /** @deprecated Prefer bodyParamBindings — static values same for all */
  variableValues?: string[];
  /** Per template var: CRM column or fixed text */
  bodyParamBindings?: import("@/lib/wa-template-merge").WaParamBinding[];
  audienceKind: AudienceKind;
  manualPhones?: string[];
  /** AND filters for lead audiences (sales person, status, source, location) */
  leadFilters?: import("@/lib/broadcast-audience-filters").BroadcastLeadFilter[];
  /** Public URL for IMAGE/VIDEO/DOCUMENT header templates */
  headerMediaUrl?: string | null;
  headerTextParams?: string[];
  createdBy?: string | null;
}) {
  const orgId = options.orgId ?? ENERTECH_ORG_ID;
  if (options.template.status !== "APPROVED") {
    throw new Error("Only APPROVED templates can be used for broadcasting");
  }

  const { bindingsAreComplete } = await import("@/lib/wa-template-merge");
  const { normalizeBroadcastLeadFilters, audienceSupportsLeadFilters } = await import(
    "@/lib/broadcast-audience-filters"
  );
  const leadFilters = audienceSupportsLeadFilters(options.audienceKind)
    ? normalizeBroadcastLeadFilters(options.leadFilters)
    : [];
  const spec = analyzeWaTemplateFromRow(options.template);
  if (spec.headerNeedsMedia) {
    const url = (options.headerMediaUrl || "").trim();
    if (!isPublicHttpUrl(url)) {
      throw new Error(
        `Template “${options.template.name}” has a ${spec.headerFormat} header. Paste a public https URL for that media (required by Meta — error #132012 if missing).`,
      );
    }
  }

  const bindings = options.bodyParamBindings || [];
  const usingBindings = bindings.length > 0;
  if (spec.bodyVarCount > 0) {
    if (usingBindings) {
      if (!bindingsAreComplete(bindings, spec.bodyVarCount)) {
        throw new Error(
          `Map all ${spec.bodyVarCount} template variable(s) to a CRM field or fixed text: ${spec.bodyVarLabels
            .map((l) => `{{${l}}}`)
            .join(", ")}`,
        );
      }
    } else if (
      (options.variableValues || []).filter((v) => String(v || "").trim()).length < spec.bodyVarCount
    ) {
      throw new Error(
        `Fill all ${spec.bodyVarCount} template variable(s): ${spec.bodyVarLabels
          .map((l) => `{{${l}}}`)
          .join(", ")}`,
      );
    }
  }

  const recipients = await resolveAudiencePhones(
    orgId,
    options.audienceKind,
    options.manualPhones || [],
    leadFilters,
  );
  if (!recipients.length) {
    throw new Error(
      leadFilters.length
        ? "No leads with phone match these filters. Check sales person / status / source / location."
        : "No recipients with phone numbers found for this audience",
    );
  }

  const supabase = getBrowserSupabase();
  const { data: broadcast, error } = await supabase
    .from("broadcasts")
    .insert({
      org_id: orgId,
      channel_type: "whatsapp",
      name: options.name.trim(),
      status: "Queued",
      template_id: options.template.id,
      template_name: options.template.name,
      template_language: options.template.language,
      variable_values: options.variableValues || [],
      audience: {
        kind: options.audienceKind,
        ...(options.headerMediaUrl?.trim()
          ? { header_media_url: options.headerMediaUrl.trim() }
          : {}),
        ...(options.headerTextParams?.length
          ? { header_text_params: options.headerTextParams }
          : {}),
        ...(usingBindings
          ? { body_param_bindings: bindings.slice(0, spec.bodyVarCount) }
          : {}),
        ...(leadFilters.length ? { lead_filters: leadFilters } : {}),
      },
      total_count: recipients.length,
      created_by: options.createdBy || null,
    })
    .select("*")
    .single();
  if (error) throw error;

  const rows = recipients.map((r) => ({
    org_id: orgId,
    broadcast_id: broadcast.id,
    phone: r.phone,
    name: r.name,
    customer_id: r.customer_id || null,
    lead_id: r.lead_id || null,
    status: "pending",
    merge_fields: r.merge_fields || null,
  }));

  let { error: recErr } = await supabase.from("broadcast_recipients").insert(rows);
  if (recErr && /merge_fields/i.test(recErr.message || "")) {
    ({ error: recErr } = await supabase.from("broadcast_recipients").insert(
      rows.map(({ merge_fields: _mf, ...rest }) => rest),
    ));
  }
  if (recErr) throw recErr;

  const result = await runWhatsAppBroadcast({ data: { broadcastId: broadcast.id as string } });
  return { broadcastId: broadcast.id as string, ...result };
}
