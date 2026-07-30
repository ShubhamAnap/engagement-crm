-- IndiaMART channel row (run AFTER this: 007_indiamart_channel.sql Step 1 must already be committed)
-- Supabase SQL Editor → New query → paste → Run

insert into public.channels (org_id, type, name, status, health, detail, is_enabled)
values (
  'a0000000-0000-4000-8000-000000000001',
  'indiamart',
  'IndiaMART',
  'Disconnected',
  0,
  'Lead Manager API',
  false
)
on conflict (org_id, type) do nothing;
