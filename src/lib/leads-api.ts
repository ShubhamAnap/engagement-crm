import { getBrowserSupabase } from "@/lib/supabase";
import type { ChannelType, DbLead, LeadStatus, PriorityLevel } from "@/lib/db-types";

export type LeadInput = {
  orgId: string;
  ownerId?: string | null;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  productLabel?: string;
  status?: LeadStatus;
  priority?: PriorityLevel;
  source?: ChannelType | null;
  score?: number;
  nextFollowUpAt?: string | null;
  notes?: string;
};

function buildLeadPayload(input: LeadInput, includeRef: boolean) {
  const now = new Date().toISOString();
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
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    product_label: input.productLabel?.trim() || null,
    last_activity_at: now,
    next_follow_up_at: input.nextFollowUpAt || null,
    metadata: {
      notes: input.notes?.trim() || null,
    },
  };
}

export async function listLeads(orgId: string): Promise<DbLead[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as DbLead[];
}

export async function createLead(input: LeadInput): Promise<DbLead> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.from("leads").insert(buildLeadPayload(input, true)).select("*").single();
  if (error) throw error;
  const lead = data as DbLead;
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
  return lead;
}

export async function updateLead(leadId: string, input: LeadInput): Promise<DbLead> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.from("leads").update(buildLeadPayload(input, false)).eq("id", leadId).select("*").single();
  if (error) throw error;
  return data as DbLead;
}

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
  const supabase = getBrowserSupabase();
  const { error } = await supabase.from("leads").delete().eq("id", leadId);
  if (error) throw error;
}
