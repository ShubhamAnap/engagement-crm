-- WordPress / WooCommerce catalog channel — RUN AS TWO SEPARATE QUERIES in Supabase SQL Editor.
-- Postgres cannot use a new enum value in the same transaction that adds it.

-- =============================================================================
-- STEP 1 — run this alone first
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'channel_type' and e.enumlabel = 'wordpress'
  ) then
    alter type public.channel_type add value 'wordpress';
  end if;
end $$;

-- =============================================================================
-- STEP 2 — run in a NEW query after Step 1 succeeds (see 034b_wordpress_channel_row.sql)
-- =============================================================================
