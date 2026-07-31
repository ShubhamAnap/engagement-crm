-- Org branding: logo + optional accent color + public storage bucket
-- Run in Supabase SQL Editor after earlier migrations.

alter table public.organizations
  add column if not exists logo_url text,
  add column if not exists logo_path text,
  add column if not exists brand_primary text;

comment on column public.organizations.logo_url is 'Public URL for company logo (sidebar / login)';
comment on column public.organizations.logo_path is 'Storage object path in branding bucket';
comment on column public.organizations.brand_primary is 'Optional hex accent e.g. #0B6E4F';

insert into storage.buckets (id, name, public, file_size_limit)
values ('branding', 'branding', true, 2097152)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit;

drop policy if exists branding_storage_public_read on storage.objects;
create policy branding_storage_public_read
  on storage.objects for select
  using (bucket_id = 'branding');

drop policy if exists branding_storage_auth_write on storage.objects;
create policy branding_storage_auth_write
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'branding');

drop policy if exists branding_storage_auth_update on storage.objects;
create policy branding_storage_auth_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'branding')
  with check (bucket_id = 'branding');

drop policy if exists branding_storage_auth_delete on storage.objects;
create policy branding_storage_auth_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'branding');
