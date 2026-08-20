/**
 * Create a new workspace (org + default channels/agents + admin profile).
 * Used by email signup, Google onboarding, and tests.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { newWidgetPublicKey } from "@/server/org-context";

export type ProvisionOrgInput = {
  orgName: string;
  fullName: string;
  email: string;
  password?: string;
  phone?: string | null;
  /** Existing auth user (Google OAuth) — skip createUser */
  authUserId?: string;
};

export type ProvisionOrgResult = {
  orgId: string;
  userId: string;
};

export async function emailHasProfile(
  supabase: SupabaseClient,
  email: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", normalized)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function seedOrgDefaults(
  supabase: SupabaseClient,
  orgId: string,
): Promise<void> {
  const { error: channelsError } = await supabase.from("channels").insert([
    {
      org_id: orgId,
      type: "website",
      name: "Website Chat",
      status: "Connected",
      health: 100,
      detail: "embed widget",
      is_enabled: true,
      config: { widget_public_key: newWidgetPublicKey() },
    },
    { org_id: orgId, type: "whatsapp", name: "WhatsApp Business", status: "Disconnected", health: 0, is_enabled: false },
    { org_id: orgId, type: "email", name: "Email", status: "Disconnected", health: 0, is_enabled: false },
    { org_id: orgId, type: "instagram", name: "Instagram", status: "Disconnected", health: 0, is_enabled: false },
    { org_id: orgId, type: "facebook", name: "Facebook Messenger", status: "Disconnected", health: 0, is_enabled: false },
    {
      org_id: orgId,
      type: "indiamart",
      name: "IndiaMART",
      status: "Disconnected",
      health: 0,
      detail: "Lead Manager API",
      is_enabled: false,
    },
    {
      org_id: orgId,
      type: "tradeindia",
      name: "TradeIndia",
      status: "Disconnected",
      health: 0,
      detail: "Inquiry API",
      is_enabled: false,
    },
    {
      org_id: orgId,
      type: "brainmine",
      name: "Brainmine CRM+",
      status: "Disconnected",
      health: 0,
      detail: "External CRM lead sync",
      is_enabled: false,
    },
    {
      org_id: orgId,
      type: "wordpress",
      name: "WordPress / WooCommerce",
      status: "Disconnected",
      health: 0,
      detail: "Product catalog pull",
      is_enabled: false,
    },
  ]);
  if (channelsError) throw new Error(`Could not create default channels: ${channelsError.message}`);

  const { error: agentsError } = await supabase.from("agents").insert([
    {
      org_id: orgId,
      key: "support",
      name: "Support Agent",
      description: "General support and enquiry handling",
      status: "Active",
      model: "gpt-4o-mini",
      memory_enabled: true,
    },
    {
      org_id: orgId,
      key: "sales",
      name: "Sales Agent",
      description: "Product discovery, pricing guidance, lead capture",
      status: "Active",
      model: "gpt-4o-mini",
      memory_enabled: true,
    },
  ]);
  if (agentsError) throw new Error(`Could not create default agents: ${agentsError.message}`);
}

export async function provisionOrganization(
  supabase: SupabaseClient,
  input: ProvisionOrgInput,
): Promise<ProvisionOrgResult> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const orgName = input.orgName.trim();

  if (!orgName || !fullName || !email) {
    throw new Error("Organization name, full name, and email are required.");
  }

  if (await emailHasProfile(supabase, email)) {
    throw new Error("An account with this email already exists.");
  }

  const shortName = orgName.split(/\s+/).slice(0, 2).join(" ");

  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .insert({ name: orgName, short_name: shortName, plan: "Free", plan_tier: "free", is_active: true })
    .select("id")
    .single();
  if (orgErr) throw new Error(orgErr.message);

  let userId = input.authUserId;
  if (!userId) {
    if (!input.password || input.password.length < 8) {
      await supabase.from("organizations").delete().eq("id", org.id);
      throw new Error("Password must be at least 8 characters.");
    }
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      phone: input.phone?.trim() || undefined,
      user_metadata: { full_name: fullName, org_id: org.id },
    });
    if (authErr) {
      await supabase.from("organizations").delete().eq("id", org.id);
      throw new Error(authErr.message);
    }
    userId = authUser.user.id;
  }

  const { error: profileErr } = await supabase.from("profiles").insert({
    id: userId,
    org_id: org.id,
    email,
    full_name: fullName,
    role: "Admin",
    phone: input.phone?.trim() || null,
    is_active: true,
  });
  if (profileErr) {
    if (!input.authUserId) {
      await supabase.auth.admin.deleteUser(userId).catch(() => undefined);
    }
    await supabase.from("organizations").delete().eq("id", org.id);
    throw new Error(profileErr.message);
  }

  // A workspace without its default channels has no widget key and an empty Channels page.
  // Roll back so the customer can retry instead of landing in a half-built workspace.
  try {
    await seedOrgDefaults(supabase, org.id);
  } catch (err) {
    console.error("[provision] seed defaults failed, rolling back workspace", err);
    await supabase.from("profiles").delete().eq("id", userId);
    if (!input.authUserId) {
      await supabase.auth.admin.deleteUser(userId).catch(() => undefined);
    }
    await supabase.from("organizations").delete().eq("id", org.id);
    throw new Error("Could not finish setting up the workspace. Please try again.");
  }

  return { orgId: org.id, userId };
}
