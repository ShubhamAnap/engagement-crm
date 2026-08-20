import { getBrowserSupabase } from "@/lib/supabase";

export type DbSalesPerson = {
  id: string;
  org_id: string;
  email: string;
  display_name: string;
  mobile: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function listSalesPersonDirectory(orgId: string): Promise<DbSalesPerson[]> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("sales_person_directory")
    .select("*")
    .eq("org_id", orgId)
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DbSalesPerson[];
}

export async function upsertSalesPerson(options: {
  orgId: string;
  id?: string;
  email: string;
  displayName: string;
  mobile?: string | null;
  isActive?: boolean;
}): Promise<DbSalesPerson> {
  const supabase = getBrowserSupabase();
  const orgId = options.orgId;
  if (!orgId) throw new Error("orgId is required to save a sales person");
  const email = normalizeEmail(options.email);
  const displayName = options.displayName.trim();
  const mobile = options.mobile?.trim() || null;
  if (!email || !email.includes("@")) throw new Error("Valid email is required");
  if (!displayName) throw new Error("Sales person name is required");

  if (options.id) {
    const { data, error } = await supabase
      .from("sales_person_directory")
      .update({
        email,
        display_name: displayName,
        mobile,
        is_active: options.isActive ?? true,
      })
      .eq("id", options.id)
      .eq("org_id", orgId)
      .select("*")
      .single();
    if (error) throw error;
    return data as DbSalesPerson;
  }

  const { data, error } = await supabase
    .from("sales_person_directory")
    .upsert(
      {
        org_id: orgId,
        email,
        display_name: displayName,
        mobile,
        is_active: options.isActive ?? true,
      },
      { onConflict: "org_id,email" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as DbSalesPerson;
}

export async function deleteSalesPerson(id: string, orgId: string): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await supabase
    .from("sales_person_directory")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) throw error;
}

/** If value looks like an email, replace with directory display name when matched. */
export function resolveSalesPersonDisplayName(
  raw: string | null | undefined,
  directory: Array<{ email: string; display_name: string; is_active?: boolean }>,
): string {
  const value = (raw || "").trim();
  if (!value) return "";
  if (!value.includes("@")) return value;
  const email = normalizeEmail(value);
  const hit = directory.find(
    (d) => normalizeEmail(d.email) === email && d.is_active !== false,
  );
  return hit?.display_name?.trim() || value;
}

export function resolveSalesPersonMobile(
  raw: string | null | undefined,
  directory: Array<{ email: string; mobile?: string | null; is_active?: boolean }>,
): string {
  const value = (raw || "").trim();
  if (!value) return "";
  if (!value.includes("@")) return "";
  const email = normalizeEmail(value);
  const hit = directory.find(
    (d) => normalizeEmail(d.email) === email && d.is_active !== false,
  );
  return (hit?.mobile || "").trim();
}
