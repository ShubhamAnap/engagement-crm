/**
 * Ensure org branding storage is ready (bucket + public read).
 * Call before logo upload so Admins don't need to run SQL just for the bucket.
 */
import { createServerFn } from "@tanstack/react-start";
import { createServiceSupabase } from "@/lib/supabase";

const BRANDING_BUCKET = "branding";

export const ensureOrgBrandingStorage = createServerFn({ method: "POST" }).handler(async () => {
  const supabase = createServiceSupabase();

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(`Could not list storage buckets: ${listError.message}`);
  }

  const exists = (buckets || []).some((b) => b.id === BRANDING_BUCKET || b.name === BRANDING_BUCKET);
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(BRANDING_BUCKET, {
      public: true,
      fileSizeLimit: 2 * 1024 * 1024,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
    });
    if (createError && !/already exists|duplicate/i.test(createError.message)) {
      throw new Error(`Could not create branding bucket: ${createError.message}`);
    }
  } else {
    await supabase.storage.updateBucket(BRANDING_BUCKET, {
      public: true,
      fileSizeLimit: 2 * 1024 * 1024,
    });
  }

  // Best-effort: add logo columns if missing (service role via RPC not available — use raw SQL if exposed)
  // Columns still require 015_org_branding.sql when ALTER isn't possible from the client.

  return { ok: true as const, bucket: BRANDING_BUCKET };
});
