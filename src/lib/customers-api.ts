import { getBrowserSupabase } from "@/lib/supabase";
import type { DbCustomer } from "@/lib/db-types";

export type CustomerInput = {
  orgId: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  notes?: string;
  installedBase?: string;
};

function buildCustomerPayload(input: CustomerInput) {
  return {
    org_id: input.orgId,
    name: input.name.trim(),
    company: input.company?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    notes: input.notes?.trim() || null,
    metadata: {
      installedBase: input.installedBase?.trim() || null,
    },
  };
}

export async function listCustomers(orgId: string): Promise<DbCustomer[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data ?? []) as DbCustomer[];
}

export async function createCustomer(input: CustomerInput): Promise<DbCustomer> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("customers")
    .insert(buildCustomerPayload(input))
    .select("*")
    .single();

  if (error) throw error;
  return data as DbCustomer;
}

export async function updateCustomer(customerId: string, input: CustomerInput): Promise<DbCustomer> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("customers")
    .update(buildCustomerPayload(input))
    .eq("id", customerId)
    .select("*")
    .single();

  if (error) throw error;
  return data as DbCustomer;
}

export async function deleteCustomer(customerId: string): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await supabase.from("customers").delete().eq("id", customerId);
  if (error) throw error;
}
