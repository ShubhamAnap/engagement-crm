/**
 * Seeds the first Admin user + profile for EnerTech Engage.
 * Prerequisites:
 *   1. Run supabase/migrations/001_foundation.sql in Supabase SQL Editor
 *   2. Fill .env with Supabase keys + SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 *
 * Usage: node --env-file=.env scripts/seed-admin.mjs
 */
import { createClient } from "@supabase/supabase-js";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;

if (!url || !serviceKey || !email || !password) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", ORG_ID)
    .maybeSingle();

  if (orgError) {
    console.error("Cannot read organizations. Did you run 001_foundation.sql?", orgError.message);
    process.exit(1);
  }
  if (!org) {
    console.error("EnerTech organization not found. Run supabase/migrations/001_foundation.sql first.");
    process.exit(1);
  }

  console.log(`Org OK: ${org.name}`);

  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (listError) {
    console.error("listUsers failed:", listError.message);
    process.exit(1);
  }

  let user = listed.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  // If email changed in .env, update the existing Admin auth user instead of creating a duplicate.
  if (!user) {
    const { data: adminProfiles } = await supabase
      .from("profiles")
      .select("id, email, role")
      .eq("org_id", ORG_ID)
      .eq("role", "Admin")
      .limit(1);
    const adminId = adminProfiles?.[0]?.id;
    if (adminId) {
      const existing = listed.users.find((u) => u.id === adminId);
      if (existing) {
        const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(adminId, {
          email,
          password,
          email_confirm: true,
        });
        if (updateError) {
          console.error("updateUser (email change) failed:", updateError.message);
          process.exit(1);
        }
        user = updated.user;
        console.log(`Moved Admin login to new email: ${user.email}`);
      }
    }
  }

  if (!user) {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "EnerTech Admin" },
    });
    if (createError) {
      console.error("createUser failed:", createError.message);
      process.exit(1);
    }
    user = created.user;
    console.log(`Created auth user: ${user.email}`);
  } else if (user.email?.toLowerCase() === email.toLowerCase()) {
    const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      email,
      password,
      email_confirm: true,
    });
    if (updateError) {
      console.error("updateUser failed:", updateError.message);
      process.exit(1);
    }
    user = updated.user;
    console.log(`Updated auth password for: ${user.email}`);
  }

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      org_id: ORG_ID,
      email: user.email,
      full_name: user.user_metadata?.full_name || "EnerTech Admin",
      role: "Admin",
    },
    { onConflict: "id" },
  );

  if (profileError) {
    console.error("profiles upsert failed:", profileError.message);
    process.exit(1);
  }

  console.log("Profile upserted as Admin.");
  console.log("Done. Log in at /login with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
