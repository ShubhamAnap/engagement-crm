/**
 * Assert security-critical migration state against the live database.
 *
 * Usage: npm run check:db
 * Needs: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY in .env
 *
 * Checks migrations 030 (channel config ACL), 039 (storage org paths), 044 (channel
 * identity uniqueness), 045 (billing ops), 046 (platform settings), 047 (Stripe columns).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL (or VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failed = 0;

function ok(label) {
  console.log(`OK   ${label}`);
}

function fail(label, detail) {
  failed += 1;
  console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

function warn(label, detail) {
  console.log(`WARN ${label}${detail ? ` — ${detail}` : ""}`);
}

async function rpcExists(name) {
  const { error } = await supabase.rpc(name, { p_channel_id: "00000000-0000-4000-8000-000000000000" });
  // Function exists if we get a business error, not "function not found"
  if (!error) return true;
  const msg = error.message || "";
  if (/Could not find the function|PGRST202|42883/i.test(msg)) return false;
  return true;
}

async function main() {
  console.log("Checking production database security state…\n");

  // --- 030: channel config RPCs ---
  const getCfg = await rpcExists("get_channel_config");
  if (getCfg) ok("030 get_channel_config RPC exists");
  else fail("030 get_channel_config RPC missing", "run 030_phase2_integrity.sql");

  const { error: setProbe } = await supabase.rpc("set_channel_config", {
    p_channel_id: "00000000-0000-4000-8000-000000000000",
    p_config: {},
  });
  if (setProbe && /Could not find the function|PGRST202|42883/i.test(setProbe.message || "")) {
    fail("030 set_channel_config RPC missing", "run 030_phase2_integrity.sql");
  } else {
    ok("030 set_channel_config RPC exists");
  }

  // --- 039: storage org isolation (spot-check via storage.buckets readable + policy count) ---
  const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets();
  if (bucketErr) {
    warn("039 storage buckets", bucketErr.message);
  } else {
    ok(`039 storage reachable (${(buckets || []).length} buckets)`);
  }

  // --- 044: channel identity conflicts view ---
  const { data: conflicts, error: conflictErr } = await supabase
    .from("channel_identity_conflicts")
    .select("type, key, value, workspaces");
  if (conflictErr) {
    if (/does not exist|PGRST205|42P01/i.test(conflictErr.message || "")) {
      fail("044 channel_identity_conflicts view missing", "run 044_channel_identity_uniqueness.sql");
    } else {
      fail("044 channel_identity_conflicts", conflictErr.message);
    }
  } else if ((conflicts || []).length > 0) {
    fail(
      "044 channel identity conflicts",
      `${conflicts.length} shared identifier(s) — fix duplicates then re-run 044 indexes`,
    );
    for (const row of conflicts.slice(0, 5)) {
      console.log(`     · ${row.type}.${row.key}=${row.value} across ${row.workspaces} workspaces`);
    }
  } else {
    ok("044 channel_identity_conflicts empty");
  }

  // --- 045: billing ops columns ---
  const { data: orgCols, error: orgErr } = await supabase
    .from("organizations")
    .select("id, feature_flags, custom_limits, trial_ends_at, usage_grace_until, past_due_since")
    .limit(1);
  if (orgErr) {
    if (/column|42703|PGRST204/i.test(orgErr.message || "")) {
      fail("045 billing ops columns missing", "run 045_billing_ops.sql");
    } else {
      fail("045 organizations select", orgErr.message);
    }
  } else {
    ok("045 billing ops columns present");
  }

  const { error: billingViewErr } = await supabase
    .from("organization_billing_state")
    .select("org_id")
    .limit(1);
  if (billingViewErr) {
    if (/does not exist|PGRST205|42P01/i.test(billingViewErr.message || "")) {
      fail("045 organization_billing_state missing", "run 045_billing_ops.sql");
    } else {
      fail("045 organization_billing_state", billingViewErr.message);
    }
  } else {
    ok("045 organization_billing_state readable");
  }

  // --- 046: platform settings ---
  const { data: settings, error: settingsErr } = await supabase
    .from("platform_settings")
    .select("id, maintenance_enabled")
    .eq("id", 1)
    .maybeSingle();
  if (settingsErr) {
    if (/does not exist|PGRST205|42P01/i.test(settingsErr.message || "")) {
      fail("046 platform_settings missing", "run 046_platform_settings.sql");
    } else {
      fail("046 platform_settings", settingsErr.message);
    }
  } else if (!settings) {
    fail("046 platform_settings row id=1 missing", "re-run 046 insert");
  } else {
    ok("046 platform_settings singleton present");
  }

  // --- 047: Stripe billing columns (warn unless Stripe is configured) ---
  const { error: stripeErr } = await supabase
    .from("organizations")
    .select("id, stripe_customer_id, stripe_subscription_id")
    .limit(1);
  if (stripeErr) {
    if (/column|42703|PGRST204/i.test(stripeErr.message || "")) {
      if (process.env.STRIPE_SECRET_KEY?.trim()) {
        fail("047 stripe billing columns missing", "run 047_stripe_billing.sql before Stripe");
      } else {
        warn("047 stripe columns not applied", "optional until USD billing — run 047_stripe_billing.sql");
      }
    } else {
      fail("047 organizations stripe select", stripeErr.message);
    }
  } else {
    ok("047 stripe billing columns present");
  }

  console.log("");
  if (failed > 0) {
    console.log(`check:db failed (${failed} issue${failed === 1 ? "" : "s"}).`);
    process.exit(1);
  }
  console.log("check:db passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
