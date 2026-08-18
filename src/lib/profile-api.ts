import { ENERTECH_NAVY_HEX } from "@/lib/brand";
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
  brandPrimary?: string | null;
};

const BRANDING_BUCKET = "branding";
const KNOWLEDGE_BUCKET = "knowledge";

function publicStorageUrl(bucket: string, storagePath: string): string {
  const supabase = getBrowserSupabase();
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

function normalizeHexColor(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const v = raw.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) return v.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(v)) {
    const r = v[1];
    const g = v[2];
    const b = v[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  throw new Error(`Brand color must be a hex value like ${ENERTECH_NAVY_HEX}`);
}

export async function updateMyProfile(input: ProfileUpdateInput) {
  const supabase = getBrowserSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Not signed in");

  const patch: Record<string, unknown> = {
    full_name: input.fullName.trim(),
    phone: input.phone?.trim() || null,
    job_title: input.jobTitle?.trim() || null,
  };
  // Only touch avatar when explicitly provided (upload/remove flows pass it)
  if (input.avatarUrl !== undefined) {
    patch.avatar_url = input.avatarUrl?.trim() || null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id)
    .select("id, email, full_name, role, phone, job_title, avatar_url, org_id")
    .single();

  if (error) throw error;
  return data;
}

async function requireAdminOrgId(): Promise<string> {
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
  return profile.org_id as string;
}

export async function updateMyOrganization(input: OrgUpdateInput) {
  const supabase = getBrowserSupabase();
  const orgId = await requireAdminOrgId();

  const patch: Record<string, unknown> = {
    name: input.name.trim(),
    short_name: input.shortName.trim(),
  };
  if (input.brandPrimary !== undefined) {
    patch.brand_primary = normalizeHexColor(input.brandPrimary);
  }

  const { data, error } = await supabase
    .from("organizations")
    .update(patch)
    .eq("id", orgId)
    .select("id, name, short_name, plan, logo_url, brand_primary")
    .single();

  if (error) {
    if (/brand_primary|logo_url|column/i.test(error.message)) {
      const fallback = await supabase
        .from("organizations")
        .update({
          name: input.name.trim(),
          short_name: input.shortName.trim(),
        })
        .eq("id", orgId)
        .select("id, name, short_name, plan")
        .single();
      if (fallback.error) throw fallback.error;
      throw new Error(
        "Company name saved, but branding columns are missing — run supabase/migrations/015_org_branding.sql",
      );
    }
    throw error;
  }
  return data;
}

export async function uploadOrgLogo(file: File): Promise<{ logoUrl: string; logoPath: string }> {
  const orgId = await requireAdminOrgId();
  const lower = file.name.toLowerCase();
  const okType =
    file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(lower);
  if (!okType) throw new Error("Logo must be an image (PNG, JPG, WebP, or SVG)");
  if (file.size > 2 * 1024 * 1024) throw new Error("Logo max size is 2 MB");

  // Create branding bucket via service role when missing
  try {
    const { ensureOrgBrandingStorage } = await import("@/server/org-branding");
    await ensureOrgBrandingStorage();
  } catch (err) {
    console.warn("ensureOrgBrandingStorage", err);
  }

  const supabase = getBrowserSupabase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : ".png";
  const safeExt = ext === ".jpeg" ? ".jpg" : ext;
  const brandingPath = `${orgId}/logo${safeExt}`;
  const knowledgePath = `${orgId}/branding/logo${safeExt}`;

  let bucket = BRANDING_BUCKET;
  let storagePath = brandingPath;

  let uploadError = (
    await supabase.storage.from(BRANDING_BUCKET).upload(brandingPath, file, {
      contentType: file.type || "image/png",
      upsert: true,
    })
  ).error;

  if (uploadError && /bucket not found|not found/i.test(uploadError.message)) {
    // Fallback: knowledge bucket already exists for most installs
    bucket = KNOWLEDGE_BUCKET;
    storagePath = knowledgePath;
    uploadError = (
      await supabase.storage.from(KNOWLEDGE_BUCKET).upload(knowledgePath, file, {
        contentType: file.type || "image/png",
        upsert: true,
      })
    ).error;
  }

  if (uploadError) {
    throw new Error(
      `Logo upload failed: ${uploadError.message}. Run supabase/migrations/015_org_branding.sql in Supabase SQL Editor.`,
    );
  }

  const logoUrl = publicStorageUrl(bucket, storagePath);
  const { error } = await supabase
    .from("organizations")
    .update({
      logo_path: `${bucket}:${storagePath}`,
      logo_url: logoUrl,
    })
    .eq("id", orgId);

  if (error) {
    throw new Error(
      /logo_/i.test(error.message)
        ? "Run supabase/migrations/015_org_branding.sql to add logo columns on organizations."
        : error.message,
    );
  }

  return { logoUrl, logoPath: storagePath };
}

export async function removeOrgLogo(): Promise<void> {
  const orgId = await requireAdminOrgId();
  const supabase = getBrowserSupabase();

  const { data: org } = await supabase
    .from("organizations")
    .select("logo_path")
    .eq("id", orgId)
    .maybeSingle();

  const rawPath = org?.logo_path as string | undefined;
  if (rawPath) {
    const [bucket, ...rest] = rawPath.includes(":")
      ? rawPath.split(":")
      : [BRANDING_BUCKET, rawPath];
    const path = rest.join(":") || rawPath;
    await supabase.storage.from(bucket || BRANDING_BUCKET).remove([path]);
    // Also try plain path in branding for older records
    if (!rawPath.includes(":")) {
      await supabase.storage.from(KNOWLEDGE_BUCKET).remove([rawPath]);
    }
  }

  const { error } = await supabase
    .from("organizations")
    .update({ logo_path: null, logo_url: null })
    .eq("id", orgId);
  if (error) throw error;
}

/** Upload current user's profile photo → profiles.avatar_url */
export async function uploadMyAvatar(file: File): Promise<{ avatarUrl: string }> {
  const supabase = getBrowserSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Not signed in");

  const lower = file.name.toLowerCase();
  const okType =
    file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(lower);
  if (!okType) throw new Error("Photo must be an image (PNG, JPG, or WebP)");
  if (file.size > 2 * 1024 * 1024) throw new Error("Photo max size is 2 MB");

  try {
    const { ensureOrgBrandingStorage } = await import("@/server/org-branding");
    await ensureOrgBrandingStorage();
  } catch (err) {
    console.warn("ensureOrgBrandingStorage", err);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  const orgId = (profile?.org_id as string) || "org";

  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : ".png";
  const safeExt = ext === ".jpeg" ? ".jpg" : ext === ".svg" ? ".png" : ext;
  const brandingPath = `${orgId}/avatars/${user.id}${safeExt}`;
  const knowledgePath = `${orgId}/avatars/${user.id}${safeExt}`;

  let bucket = BRANDING_BUCKET;
  let storagePath = brandingPath;
  let uploadError = (
    await supabase.storage.from(BRANDING_BUCKET).upload(brandingPath, file, {
      contentType: file.type || "image/png",
      upsert: true,
    })
  ).error;

  if (uploadError && /bucket not found|not found/i.test(uploadError.message)) {
    bucket = KNOWLEDGE_BUCKET;
    storagePath = knowledgePath;
    uploadError = (
      await supabase.storage.from(KNOWLEDGE_BUCKET).upload(knowledgePath, file, {
        contentType: file.type || "image/png",
        upsert: true,
      })
    ).error;
  }

  if (uploadError) {
    throw new Error(
      `Photo upload failed: ${uploadError.message}. Run 015_org_branding.sql or ensure the knowledge storage bucket exists.`,
    );
  }

  // Cache-bust so TopBar updates immediately
  const avatarUrl = `${publicStorageUrl(bucket, storagePath)}?t=${Date.now()}`;
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", user.id);

  if (error) {
    throw new Error(
      /avatar_url/i.test(error.message)
        ? "Run supabase/migrations/006_profile_fields.sql (adds avatar_url)."
        : error.message,
    );
  }

  return { avatarUrl };
}

export async function removeMyAvatar(): Promise<void> {
  const supabase = getBrowserSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_url, org_id")
    .eq("id", user.id)
    .maybeSingle();

  const orgId = (profile?.org_id as string) || "org";
  // Best-effort remove common paths
  const candidates = [
    `${orgId}/avatars/${user.id}.png`,
    `${orgId}/avatars/${user.id}.jpg`,
    `${orgId}/avatars/${user.id}.webp`,
    `${orgId}/avatars/${user.id}.gif`,
  ];
  await supabase.storage.from(BRANDING_BUCKET).remove(candidates);
  await supabase.storage.from(KNOWLEDGE_BUCKET).remove(candidates);

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", user.id);
  if (error) throw error;
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
