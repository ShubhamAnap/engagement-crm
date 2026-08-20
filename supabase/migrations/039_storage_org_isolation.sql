-- Phase 2: isolate Storage objects by org_id path prefix `{org_id}/…`
-- Run in Supabase SQL Editor after earlier migrations.
--
-- Authenticated list/upload/delete can only touch objects under the caller's org.
-- Buckets stay public so WhatsApp/Meta can fetch HTTPS media by exact URL.
-- Public URLs do not list the bucket; guessing another org UUID is required.

create or replace function public.storage_is_current_org_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    object_name is not null
    and public.current_org_id() is not null
    and split_part(object_name, '/', 1) = public.current_org_id()::text
$$;

grant execute on function public.storage_is_current_org_object(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- knowledge
-- ---------------------------------------------------------------------------

drop policy if exists knowledge_storage_public_read on storage.objects;
drop policy if exists knowledge_storage_auth_write on storage.objects;
drop policy if exists knowledge_storage_auth_update on storage.objects;
drop policy if exists knowledge_storage_auth_delete on storage.objects;
drop policy if exists knowledge_storage_auth_select on storage.objects;

create policy knowledge_storage_auth_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'knowledge'
    and public.storage_is_current_org_object(name)
  );

create policy knowledge_storage_auth_write
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'knowledge'
    and public.storage_is_current_org_object(name)
  );

create policy knowledge_storage_auth_update
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'knowledge'
    and public.storage_is_current_org_object(name)
  )
  with check (
    bucket_id = 'knowledge'
    and public.storage_is_current_org_object(name)
  );

create policy knowledge_storage_auth_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'knowledge'
    and public.storage_is_current_org_object(name)
  );

-- ---------------------------------------------------------------------------
-- branding
-- ---------------------------------------------------------------------------

drop policy if exists branding_storage_public_read on storage.objects;
drop policy if exists branding_storage_auth_write on storage.objects;
drop policy if exists branding_storage_auth_update on storage.objects;
drop policy if exists branding_storage_auth_delete on storage.objects;
drop policy if exists branding_storage_auth_select on storage.objects;

create policy branding_storage_auth_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'branding'
    and public.storage_is_current_org_object(name)
  );

create policy branding_storage_auth_write
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'branding'
    and public.storage_is_current_org_object(name)
  );

create policy branding_storage_auth_update
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'branding'
    and public.storage_is_current_org_object(name)
  )
  with check (
    bucket_id = 'branding'
    and public.storage_is_current_org_object(name)
  );

create policy branding_storage_auth_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'branding'
    and public.storage_is_current_org_object(name)
  );
