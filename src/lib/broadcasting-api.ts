import { getBrowserSupabase } from "@/lib/supabase";
import { ENERTECH_ORG_ID } from "@/lib/chat-api";
import {
  runWhatsAppBroadcast,
  submitWhatsAppTemplateToMeta,
  syncWhatsAppTemplatesFromMeta,
  countTemplateVars,
  sendInboxWhatsAppTemplate,
} from "@/server/whatsapp-broadcast";

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
  | "manual_emails";

export { countTemplateVars, syncWhatsAppTemplatesFromMeta, submitWhatsAppTemplateToMeta, runWhatsAppBroadcast, sendInboxWhatsAppTemplate };

export async function createAndSendEmailBroadcast(options: {
  orgId?: string;
  name: string;
  subject: string;
  body: string;
  format: "text" | "html";
  audienceKind: AudienceKind;
  manualEmails?: string[];
  createdBy?: string | null;
}) {
  const orgId = options.orgId ?? ENERTECH_ORG_ID;
  const recipients = await resolveAudienceEmails(
    orgId,
    options.audienceKind,
    options.manualEmails || [],
  );
  if (!recipients.length) throw new Error("No recipients with email found for this audience");

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
      audience: { kind: options.audienceKind },
      total_count: recipients.length,
      created_by: options.createdBy || null,
    })
    .select("*")
    .single();
  if (error) throw error;

  const { error: recErr } = await supabase.from("broadcast_recipients").insert(
    recipients.map((r) => ({
      org_id: orgId,
      broadcast_id: broadcast.id,
      phone: null,
      email: r.email,
      name: r.name,
      customer_id: r.customer_id || null,
      lead_id: r.lead_id || null,
      status: "pending",
    })),
  );
  if (recErr) throw recErr;

  const { runGmailEmailBroadcast } = await import("@/server/gmail");
  const result = await runGmailEmailBroadcast({ data: { broadcastId: broadcast.id as string } });
  return { broadcastId: broadcast.id as string, ...result };
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
      .select("id, name, email")
      .eq("org_id", orgId)
      .not("email", "is", null)
      .limit(500);
    if (error) throw error;
    for (const c of data ?? []) push(c.email as string, c.name as string, { customer_id: c.id as string });
    return out;
  }

  const { data, error } = await supabase
    .from("leads")
    .select("id, name, email, source")
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
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DbWaTemplate[];
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

async function resolveAudiencePhones(
  orgId: string,
  kind: AudienceKind,
  manualPhones: string[],
): Promise<Array<{ phone: string; name: string | null; customer_id?: string; lead_id?: string }>> {
  const supabase = getBrowserSupabase();
  const out: Array<{ phone: string; name: string | null; customer_id?: string; lead_id?: string }> = [];
  const seen = new Set<string>();

  const push = (phone: string | null | undefined, name: string | null, ids?: { customer_id?: string; lead_id?: string }) => {
    const digits = (phone || "").replace(/\D/g, "");
    if (digits.length < 8 || seen.has(digits)) return;
    seen.add(digits);
    out.push({ phone: digits, name, ...ids });
  };

  if (kind === "manual") {
    for (const line of manualPhones) push(line, null);
    return out;
  }

  if (kind === "customers_with_phone") {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, phone")
      .eq("org_id", orgId)
      .not("phone", "is", null)
      .limit(500);
    if (error) throw error;
    for (const c of data ?? []) push(c.phone as string, c.name as string, { customer_id: c.id as string });
    return out;
  }

  const { data, error } = await supabase
    .from("leads")
    .select("id, name, phone, source")
    .eq("org_id", orgId)
    .not("phone", "is", null)
    .limit(500);
  if (error) throw error;
  for (const l of data ?? []) {
    if (kind === "indiamart_leads" && l.source !== "indiamart") continue;
    push(l.phone as string, l.name as string, { lead_id: l.id as string });
  }
  return out;
}

export async function createAndSendBroadcast(options: {
  orgId?: string;
  name: string;
  template: DbWaTemplate;
  variableValues: string[];
  audienceKind: AudienceKind;
  manualPhones?: string[];
  createdBy?: string | null;
}) {
  const orgId = options.orgId ?? ENERTECH_ORG_ID;
  if (options.template.status !== "APPROVED") {
    throw new Error("Only APPROVED templates can be used for broadcasting");
  }

  const recipients = await resolveAudiencePhones(
    orgId,
    options.audienceKind,
    options.manualPhones || [],
  );
  if (!recipients.length) throw new Error("No recipients with phone numbers found for this audience");

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
      variable_values: options.variableValues,
      audience: { kind: options.audienceKind },
      total_count: recipients.length,
      created_by: options.createdBy || null,
    })
    .select("*")
    .single();
  if (error) throw error;

  const { error: recErr } = await supabase.from("broadcast_recipients").insert(
    recipients.map((r) => ({
      org_id: orgId,
      broadcast_id: broadcast.id,
      phone: r.phone,
      name: r.name,
      customer_id: r.customer_id || null,
      lead_id: r.lead_id || null,
      status: "pending",
    })),
  );
  if (recErr) throw recErr;

  const result = await runWhatsAppBroadcast({ data: { broadcastId: broadcast.id as string } });
  return { broadcastId: broadcast.id as string, ...result };
}
