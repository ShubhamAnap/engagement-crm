-- IndiaMART channel — RUN AS TWO SEPARATE QUERIES in Supabase SQL Editor.
-- Postgres cannot use a new enum value in the same transaction that adds it.

-- =============================================================================
-- STEP 1 — run this alone, then click Run (must succeed before Step 2)
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'channel_type' and e.enumlabel = 'indiamart'
  ) then
    alter type public.channel_type add value 'indiamart';
  end if;
end $$;

-- =============================================================================
-- STEP 2 — run this in a NEW query (after Step 1 has finished)
-- =============================================================================
-- insert into public.channels (org_id, type, name, status, health, detail, is_enabled)
-- values (
--   'a0000000-0000-4000-8000-000000000001',
--   'indiamart',
--   'IndiaMART',
--   'Disconnected',
--   0,
--   'Lead Manager API',
--   false
-- )
-- on conflict (org_id, type) do nothing;
