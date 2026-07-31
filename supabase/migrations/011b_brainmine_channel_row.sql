-- Brainmine channel row — run AFTER 011_brainmine_channel.sql Step 1 has committed

insert into public.channels (org_id, type, name, status, health, detail, is_enabled)
values (
  'a0000000-0000-4000-8000-000000000001',
  'brainmine',
  'Brainmine CRM+',
  'Disconnected',
  0,
  'External CRM lead sync (read-only)',
  false
)
on conflict (org_id, type) do nothing;
