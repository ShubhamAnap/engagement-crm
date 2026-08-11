import { getBrowserSupabase } from "@/lib/supabase";
import type { ChannelType, DbLead, LeadStatus, PriorityLevel } from "@/lib/db-types";
import { normalizeLeadPhone } from "@/lib/whatsapp-window";
import { canLeadsCreate, canLeadsDelete } from "@/lib/permissions";

export type LeadInput = {
  orgId: string;
  ownerId?: string | null;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  /** Alias kept for pipeline/inbox — synced from requirement */
  productLabel?: string;
  requirement?: string;
  notes?: string;
  tags?: string[];
  location?: string;
  salesPerson?: string;
  status?: LeadStatus;
  priority?: PriorityLevel;
  source?: ChannelType | null;
  score?: number;
  nextFollowUpAt?: string | null;
  /** Conversation / CRM follow-up blurb stored in metadata.follow_up_summary */
  followUpSummary?: string | null;
};

export type LeadRow = DbLead & {
  owner_name?: string | null;
};

export type LeadFollowUpFilter = "all" | "overdue" | "today" | "upcoming";

export type LeadListFilters = {
  search?: string;
  status?: LeadStatus | "All";
  source?: ChannelType | "All";
  crmSource?: string;
  salesPerson?: string;
  priority?: PriorityLevel | "All";
  followUp?: LeadFollowUpFilter;
};

export type LeadListResult = {
  rows: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type LeadFacets = {
  sources: Array<{ value: string; count: number }>;
  crmSources: Array<{ value: string; count: number }>;
  salesPeople: string[];
};

export const LEADS_PAGE_SIZE = 50;
/** Pipeline / Kanban still loads a large sheet (not the paged master UI). */
export const LEADS_PIPELINE_LIMIT = 2000;

function parseTags(raw: string | string[] | undefined | null): string[] {
  if (Array.isArray(raw)) {
    return raw.map((t) => t.trim()).filter(Boolean);
  }
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function buildLeadPayload(input: LeadInput, includeRef: boolean, existingMeta?: Record<string, unknown> | null) {
  const now = new Date().toISOString();
  const requirement = (input.requirement ?? input.productLabel)?.trim() || null;
  const notes = input.notes?.trim() || null;
  const tags = parseTags(input.tags);
  const prev =
    existingMeta && typeof existingMeta === "object" && !Array.isArray(existingMeta)
      ? { ...existingMeta }
      : {};
  return {
    org_id: input.orgId,
    owner_id: input.ownerId ?? null,
    ...(includeRef ? { external_ref: `LD-${Date.now().toString().slice(-6)}` } : {}),
    score: input.score ?? 55,
    status: input.status ?? "New",
    priority: input.priority ?? "Medium",
    source: input.source ?? "website",
    name: input.name.trim(),
    company: input.company?.trim() || null,
    phone: normalizeLeadPhone(input.phone) || input.phone?.trim() || null,
    email: input.email?.trim() || null,
    product_label: requirement,
    requirement,
    notes,
    tags,
    location: input.location?.trim() || null,
    sales_person: input.salesPerson?.trim() || null,
    last_activity_at: now,
    next_follow_up_at: input.nextFollowUpAt || null,
    metadata: {
      ...prev,
      notes,
      ...(typeof input.followUpSummary === "string"
        ? { follow_up_summary: input.followUpSummary.trim() || null }
        : {}),
    },
  };
}

function normalizeLead(row: Record<string, unknown>): LeadRow {
  const owner = row.owner as { full_name?: string } | { full_name?: string }[] | null | undefined;
  const ownerObj = Array.isArray(owner) ? owner[0] : owner;
  const tags = Array.isArray(row.tags) ? (row.tags as string[]) : [];
  const meta = (row.metadata && typeof row.metadata === "object"
    ? row.metadata
    : {}) as Record<string, unknown>;
  return {
    ...(row as unknown as DbLead),
    tags,
    requirement: (row.requirement as string) || (row.product_label as string) || null,
    notes: (row.notes as string) || (typeof meta.notes === "string" ? meta.notes : null),
    location: (row.location as string) || null,
    sales_person: (row.sales_person as string) || null,
    owner_name: ownerObj?.full_name || (row.sales_person as string) || null,
  };
}

/** Enforce Team tick-marks (Admin bypass). create = Add/Edit/import/bulk assign+status. */
async function assertLeadAction(action: "create" | "delete"): Promise<void> {
  const supabase = getBrowserSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("Not signed in");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, permissions")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new Error("Profile not found");

  const role = String(profile.role || "");
  const permissions = profile.permissions;
  if (action === "create") {
    if (!canLeadsCreate(role, permissions)) {
      throw new Error("You do not have permission to add or edit leads");
    }
    return;
  }
  if (!canLeadsDelete(role, permissions)) {
    throw new Error("You do not have permission to delete leads");
  }
}

function sanitizeSearch(raw: string): string {
  return raw.replace(/[%_,.()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function applyLeadFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  orgId: string,
  options: LeadListFilters,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  let q = query.eq("org_id", orgId);
  if (options.status && options.status !== "All") q = q.eq("status", options.status);
  if (options.source && options.source !== "All") q = q.eq("source", options.source);
  if (options.crmSource && options.crmSource !== "All") {
    q = q.eq("crm_source", options.crmSource);
  }
  if (options.priority && options.priority !== "All") q = q.eq("priority", options.priority);
  if (options.salesPerson && options.salesPerson !== "All") {
    q = q.eq("sales_person", options.salesPerson);
  }

  const now = new Date();
  if (options.followUp === "overdue") {
    q = q.not("next_follow_up_at", "is", null).lt("next_follow_up_at", now.toISOString());
  } else if (options.followUp === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    q = q
      .gte("next_follow_up_at", start.toISOString())
      .lte("next_follow_up_at", end.toISOString());
  } else if (options.followUp === "upcoming") {
    q = q.gt("next_follow_up_at", now.toISOString());
  }

  const search = sanitizeSearch(options.search || "");
  if (search) {
    const like = `%${search}%`;
    q = q.or(
      [
        `name.ilike.${like}`,
        `company.ilike.${like}`,
        `email.ilike.${like}`,
        `phone.ilike.${like}`,
        `requirement.ilike.${like}`,
        `product_label.ilike.${like}`,
        `sales_person.ilike.${like}`,
        `location.ilike.${like}`,
        `notes.ilike.${like}`,
        `external_ref.ilike.${like}`,
        `crm_source.ilike.${like}`,
      ].join(","),
    );
  }
  return q;
}

/** Paged master-sheet query with server-side filters + exact total. */
export async function listLeadsPage(
  orgId: string,
  options: LeadListFilters & { page?: number; pageSize?: number } = {},
): Promise<LeadListResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, options.pageSize ?? LEADS_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = getBrowserSupabase();
  const select = "*, owner:profiles!leads_owner_id_fkey(full_name)";

  let query = applyLeadFilters(
    supabase.from("leads").select(select, { count: "exact" }),
    orgId,
    options,
  );
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) {
    // Fallback if FK hint fails on older schemas
    let fallback = applyLeadFilters(
      supabase.from("leads").select("*", { count: "exact" }),
      orgId,
      options,
    );
    fallback = fallback.order("created_at", { ascending: false }).range(from, to);
    const res = await fallback;
    if (res.error) throw res.error;
    return {
      rows: (res.data ?? []).map((row: Record<string, unknown>) => normalizeLead(row)),
      total: res.count ?? 0,
      page,
      pageSize,
    };
  }

  return {
    rows: (data ?? []).map((row: Record<string, unknown>) => normalizeLead(row)),
    total: count ?? 0,
    page,
    pageSize,
  };
}

/** Facet values for filters (sourced from DB, not the current page only). */
export async function listLeadFacets(orgId: string): Promise<LeadFacets> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("leads")
    .select("source, crm_source, sales_person")
    .eq("org_id", orgId)
    .limit(5000);
  if (error) throw error;

  const sourceMap = new Map<string, number>();
  const crmMap = new Map<string, number>();
  const salesSet = new Set<string>();
  for (const row of data ?? []) {
    const src = String(row.source || "website");
    sourceMap.set(src, (sourceMap.get(src) || 0) + 1);
    const crm = String(row.crm_source || "").trim();
    if (crm) crmMap.set(crm, (crmMap.get(crm) || 0) + 1);
    const sp = String(row.sales_person || "").trim();
    if (sp) salesSet.add(sp);
  }

  return {
    sources: [...sourceMap.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value)),
    crmSources: [...crmMap.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value)),
    salesPeople: [...salesSet].sort((a, b) => a.localeCompare(b)),
  };
}

/** Full-ish list for Pipeline Kanban (not paged master UI). */
export async function listLeads(orgId: string): Promise<LeadRow[]> {
  const result = await listLeadsPage(orgId, { page: 1, pageSize: LEADS_PIPELINE_LIMIT });
  return result.rows;
}

export async function listOrgSalesPeople(
  orgId: string,
): Promise<Array<{ id: string; name: string }>> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("org_id", orgId)
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.full_name as string) || (p.email as string) || "User",
  }));
}

export async function createLead(
  input: LeadInput,
  options?: { fireAutomation?: boolean },
): Promise<DbLead> {
  await assertLeadAction("create");
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.from("leads").insert(buildLeadPayload(input, true)).select("*").single();
  if (error) throw error;
  const lead = data as DbLead;
  const fire = options?.fireAutomation !== false;
  if (fire) {
    try {
      const { fireAutomationTrigger } = await import("@/lib/automations-api");
      await fireAutomationTrigger({
        data: {
          trigger: "lead_created",
          leadId: lead.id,
          source: lead.source || undefined,
        },
      });
    } catch (err) {
      console.error("lead_created automation", err);
    }
  }
  return lead;
}

export async function updateLead(leadId: string, input: LeadInput): Promise<DbLead> {
  await assertLeadAction("create");
  const supabase = getBrowserSupabase();
  // Preserve status-change automation when status changes; keep CRM metadata (follow-up summary, brainmine ids)
  const { data: prev } = await supabase
    .from("leads")
    .select("status, metadata")
    .eq("id", leadId)
    .maybeSingle();
  const existingMeta =
    prev?.metadata && typeof prev.metadata === "object" && !Array.isArray(prev.metadata)
      ? (prev.metadata as Record<string, unknown>)
      : null;
  const { data, error } = await supabase
    .from("leads")
    .update(buildLeadPayload(input, false, existingMeta))
    .eq("id", leadId)
    .select("*")
    .single();
  if (error) throw error;
  const lead = data as DbLead;
  if (prev?.status && input.status && prev.status !== input.status) {
    try {
      const { fireAutomationTrigger } = await import("@/lib/automations-api");
      await fireAutomationTrigger({
        data: {
          trigger: "lead_status_changed",
          leadId: lead.id,
          toStatus: lead.status,
        },
      });
    } catch (err) {
      console.error("lead_status_changed automation", err);
    }
  }
  return lead;
}

/** Used by Pipeline — not gated by leads_create (Pipeline section access). */
export async function updateLeadStatus(leadId: string, status: LeadStatus): Promise<DbLead> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("leads")
    .update({ status, last_activity_at: new Date().toISOString() })
    .eq("id", leadId)
    .select("*")
    .single();
  if (error) throw error;
  const lead = data as DbLead;
  try {
    const { fireAutomationTrigger } = await import("@/lib/automations-api");
    await fireAutomationTrigger({
      data: {
        trigger: "lead_status_changed",
        leadId: lead.id,
        toStatus: status,
      },
    });
  } catch (err) {
    console.error("lead_status_changed automation", err);
  }
  return lead;
}

export async function updateLeadStage(
  leadId: string,
  updates: { status: LeadStatus; priority: PriorityLevel },
): Promise<DbLead> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("leads")
    .update({ status: updates.status, priority: updates.priority, last_activity_at: new Date().toISOString() })
    .eq("id", leadId)
    .select("*")
    .single();
  if (error) throw error;
  return data as DbLead;
}

export async function deleteLead(leadId: string): Promise<void> {
  await assertLeadAction("delete");
  const supabase = getBrowserSupabase();
  const { error } = await supabase.from("leads").delete().eq("id", leadId);
  if (error) throw error;
}

/** Delete many leads by id (chunked). Scoped to org for safety. */
export async function bulkDeleteLeads(orgId: string, leadIds: string[]): Promise<number> {
  if (leadIds.length === 0) return 0;
  await assertLeadAction("delete");
  const supabase = getBrowserSupabase();
  const chunkSize = 200;
  let total = 0;
  for (let i = 0; i < leadIds.length; i += chunkSize) {
    const chunk = leadIds.slice(i, i + chunkSize);
    const { count, error } = await supabase
      .from("leads")
      .delete({ count: "exact" })
      .eq("org_id", orgId)
      .in("id", chunk);
    if (error) throw error;
    total += count ?? chunk.length;
  }
  return total;
}

/** Permanently delete every lead with the given source (e.g. brainmine, indiamart). */
export async function deleteLeadsBySource(
  orgId: string,
  source: ChannelType,
): Promise<number> {
  await assertLeadAction("delete");
  const supabase = getBrowserSupabase();
  const { count, error } = await supabase
    .from("leads")
    .delete({ count: "exact" })
    .eq("org_id", orgId)
    .eq("source", source);
  if (error) throw error;
  return count ?? 0;
}

/** Count leads for a source (for delete confirmation). */
export async function countLeadsBySource(
  orgId: string,
  source: ChannelType,
): Promise<number> {
  const supabase = getBrowserSupabase();
  const { count, error } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("source", source);
  if (error) throw error;
  return count ?? 0;
}

/** Bulk-assign owner + sales person name on selected leads. */
export async function bulkAssignLeads(options: {
  leadIds: string[];
  ownerId: string | null;
  salesPerson: string;
}): Promise<number> {
  if (options.leadIds.length === 0) return 0;
  await assertLeadAction("create");
  const supabase = getBrowserSupabase();
  const now = new Date().toISOString();
  const { error, count } = await supabase
    .from("leads")
    .update(
      {
        owner_id: options.ownerId,
        sales_person: options.salesPerson.trim() || null,
        last_activity_at: now,
      },
      { count: "exact" },
    )
    .in("id", options.leadIds);
  if (error) throw error;
  return count ?? options.leadIds.length;
}

/** Bulk status update (fires automation per lead when status changes). */
export async function bulkUpdateLeadStatus(options: {
  leadIds: string[];
  status: LeadStatus;
}): Promise<number> {
  if (options.leadIds.length === 0) return 0;
  await assertLeadAction("create");
  let updated = 0;
  for (const id of options.leadIds) {
    await updateLeadStatus(id, options.status);
    updated += 1;
  }
  return updated;
}

function csvEscape(value: unknown): string {
  const raw = value == null ? "" : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

/** Build CSV for export (browser download). */
export function buildLeadsCsv(leads: LeadRow[]): string {
  const headers = [
    "Company",
    "Name",
    "Email",
    "Phone",
    "Location",
    "Source",
    "CRM Source",
    "CRM ID",
    "CRM Created",
    "CRM Modified",
    "Requirement",
    "Sales Person",
    "Status",
    "Priority",
    "Note",
    "Tags",
    "Next Follow-up",
    "Created At",
    "Engage Ref",
    "ID",
  ];
  const lines = [headers.join(",")];
  for (const lead of leads) {
    // CRM ID = external_ref when source is CRM; Engage Ref kept for LD-… style refs only once
    const isEngageRef = String(lead.external_ref || "").startsWith("LD-");
    lines.push(
      [
        lead.company,
        lead.name,
        lead.email,
        lead.phone,
        lead.location,
        lead.source,
        lead.crm_source,
        isEngageRef ? "" : lead.external_ref,
        lead.crm_created_at,
        lead.crm_modified_at,
        lead.requirement || lead.product_label,
        lead.sales_person || lead.owner_name,
        lead.status,
        lead.priority,
        lead.notes,
        (lead.tags || []).join("; "),
        lead.next_follow_up_at,
        lead.created_at,
        isEngageRef ? lead.external_ref : "",
        lead.id,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function downloadLeadsCsv(leads: LeadRow[], filename?: string) {
  const csv = buildLeadsCsv(leads);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    filename ||
    `enertech-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
