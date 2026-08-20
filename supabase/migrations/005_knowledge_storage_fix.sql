-- Fix / bootstrap Knowledge Storage bucket + policies
-- Run this in Supabase SQL Editor if uploads fail with "bucket not found" or RLS errors.
-- After 039_storage_org_isolation.sql, do not re-apply the blanket SELECT/INSERT policies below;
-- they allow any authenticated user to list/write the whole bucket.

insert into storage.buckets (id, name, public, file_size_limit)
values ('knowledge', 'knowledge', true, 15728640)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit;

-- Allow public download of catalogue/manual PDFs
drop policy if exists knowledge_storage_public_read on storage.objects;
create policy knowledge_storage_public_read
  on storage.objects for select
  using (bucket_id = 'knowledge');

-- Authenticated app users can upload/update/delete
drop policy if exists knowledge_storage_auth_write on storage.objects;
create policy knowledge_storage_auth_write
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'knowledge');

drop policy if exists knowledge_storage_auth_update on storage.objects;
create policy knowledge_storage_auth_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'knowledge')
  with check (bucket_id = 'knowledge');

drop policy if exists knowledge_storage_auth_delete on storage.objects;
create policy knowledge_storage_auth_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'knowledge');
