# Supabase migration gate (ops checklist)

EnerTech Engage applies SQL **manually** in the Supabase SQL Editor (not auto-migrate on Render).

## Before promoting code that needs new SQL

1. Open the new file under `supabase/migrations/` (highest number first if several).
2. Paste into Supabase → **SQL Editor** → Run.
3. If a unique index fails: clean duplicates for that key, re-run the failed statements.
4. Confirm the feature that depends on the migration (broadcast claim, cron lease, etc.).
5. Only then treat Render deploy as fully healthy.

## Recent hardening migrations

| File | Purpose |
|------|---------|
| `029_broadcast_claim.sql` | Atomic broadcast recipient claim + unique audience rows |
| `030_phase2_integrity.sql` | Lead/message unique IDs, cron lease, claim helpers, profile/channel ACL |

## CI

`npm run check:migrations` verifies filenames are uniquely prefixed. It does **not** apply SQL to production.
