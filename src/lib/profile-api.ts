import { getBrowserSupabase } from "@/lib/supabase";
import type { AppRole } from "@/lib/types";

export type ProfileUpdateInput = {
  fullName: string;
  phone?: string;
  jobTitle?: string;
  avatarUrl?: string;
};

export type OrgUpdateInput = {
  name: string;
  shortName: string;
};

export async function updateMyProfile(input: ProfileUpdateInput) {
  const supabase = getBrowserSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("profiles")
    .update({
      full_name: input.fullName.trim(),
      phone: input.phone?.trim() || null,
      job_title: input.jobTitle?.trim() || null,
      avatar_url: input.avatarUrl?.trim() || null,
    })
    .eq("id", user.id)
    .select("id, email, full_name, role, phone, job_title, avatar_url, org_id")
    .single();

  if (error) throw error;
  return data;
}

export async function updateMyOrganization(input: OrgUpdateInput) {
  const supabase = getBrowserSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Not signed in");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();
  if (profileError) throw profileError;
  if ((profile.role as AppRole) !== "Admin") {
    throw new Error("Only Admins can update company profile");
  }

  const { data, error } = await supabase
    .from("organizations")
    .update({
      name: input.name.trim(),
      short_name: input.shortName.trim(),
    })
    .eq("id", profile.org_id)
    .select("id, name, short_name, plan")
    .single();

  if (error) throw error;
  return data;
}

export async function updateMyEmail(email: string) {
  const supabase = getBrowserSupabase();
  const next = email.trim().toLowerCase();
  if (!next || !next.includes("@")) throw new Error("Enter a valid email");

  const { error: authError } = await supabase.auth.updateUser({ email: next });
  if (authError) throw authError;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  // Keep profiles.email in sync (may still be old until email confirm, depending on Supabase settings)
  await supabase.from("profiles").update({ email: next }).eq("id", user.id);
  return { ok: true, email: next };
}

export async function updateMyPassword(newPassword: string) {
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
  const supabase = getBrowserSupabase();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return { ok: true };
}
