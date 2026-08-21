#!/usr/bin/env node
/**
 * Phase 6 prelaunch readiness check.
 *
 * Usage:
 *   node --env-file=.env scripts/launch-readiness.mjs
 *   npm run check:launch
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function exists(rel) {
  return fs.existsSync(path.resolve(root, rel));
}

function value(name) {
  return String(process.env[name] || "").trim();
}

function ok(label) {
  console.log(`OK   ${label}`);
}

function warn(label) {
  console.log(`WARN ${label}`);
}

function fail(label) {
  console.log(`FAIL ${label}`);
}

let failed = false;

const requiredFiles = [
  "supabase/migrations/039_storage_org_isolation.sql",
  "supabase/migrations/040_auth_completeness.sql",
  "supabase/migrations/041_billing.sql",
  "supabase/migrations/042_platform_admin.sql",
  "supabase/migrations/043_platform_impersonation.sql",
  "supabase/migrations/044_channel_identity_uniqueness.sql",
  "supabase/migrations/045_billing_ops.sql",
  "supabase/migrations/046_platform_settings.sql",
  "docs/launch-runbook.md",
  "src/routes/terms.tsx",
  "src/routes/privacy.tsx",
  "src/routes/status.tsx",
];

for (const rel of requiredFiles) {
  if (exists(rel)) ok(`file present: ${rel}`);
  else {
    fail(`missing file: ${rel}`);
    failed = true;
  }
}

const requiredEnv = [
  "VITE_APP_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "WIDGET_PUBLIC_KEY",
  "VITE_WIDGET_PUBLIC_KEY",
  "CRON_SECRET",
];

for (const key of requiredEnv) {
  if (value(key)) ok(`env set: ${key}`);
  else {
    fail(`env missing: ${key}`);
    failed = true;
  }
}

const optionalEnv = [
  "OPENAI_API_KEY",
  "PLATFORM_ADMIN_EMAILS",
  "META_APP_SECRET",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "RAZORPAY_PLAN_STARTER",
  "RAZORPAY_PLAN_PRO",
];

for (const key of optionalEnv) {
  if (value(key)) ok(`optional env set: ${key}`);
  else warn(`optional env missing: ${key}`);
}

if (value("VITE_APP_URL") && !/^https?:\/\//i.test(value("VITE_APP_URL"))) {
  fail("VITE_APP_URL must be an http/https URL");
  failed = true;
}

if (value("SUPABASE_URL") && value("VITE_SUPABASE_URL") && value("SUPABASE_URL") !== value("VITE_SUPABASE_URL")) {
  warn("SUPABASE_URL and VITE_SUPABASE_URL differ");
}

if (value("WIDGET_PUBLIC_KEY") && value("VITE_WIDGET_PUBLIC_KEY") && value("WIDGET_PUBLIC_KEY") !== value("VITE_WIDGET_PUBLIC_KEY")) {
  fail("WIDGET_PUBLIC_KEY and VITE_WIDGET_PUBLIC_KEY must match");
  failed = true;
}

if (/^(1|true|yes)$/i.test(value("META_WEBHOOK_ALLOW_UNSIGNED"))) {
  fail("META_WEBHOOK_ALLOW_UNSIGNED is on — unsigned Meta webhooks can post into any workspace");
  failed = true;
} else if (!value("META_APP_SECRET")) {
  warn("META_APP_SECRET unset — Meta webhooks will be rejected in production");
}

// Razorpay events carry the target workspace in notes.org_id, so an unverified event could
// hand any workspace a paid plan. Selling plans without the secret is not launchable.
if (value("RAZORPAY_KEY_ID") && !value("RAZORPAY_WEBHOOK_SECRET")) {
  fail("RAZORPAY_KEY_ID is set without RAZORPAY_WEBHOOK_SECRET — billing webhooks will be rejected");
  failed = true;
}

console.log("");
console.log("Manual launch signoff still required:");
console.log("- Run migrations 039-046 in production Supabase");
console.log("- Confirm public.channel_identity_conflicts returns no rows");
console.log("- Run npm run check:db against production service role");
console.log("- Check the Risk tab in /platform loads and reports no unexpected signals");
console.log("- Complete two-org isolation pass from docs/launch-runbook.md");
console.log("- Complete backup/restore drill");
console.log("- Test delete-account and delete-workspace in staging");
console.log("- Review Terms and Privacy copy");

if (failed) {
  console.log("");
  console.log("Launch readiness check failed.");
  process.exit(1);
}

console.log("");
console.log("Launch readiness check passed.");
