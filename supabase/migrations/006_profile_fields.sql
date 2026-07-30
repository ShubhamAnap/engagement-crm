-- Profile + org fields for Settings / Profile setup
-- Run in Supabase SQL Editor after 001–005

alter table public.profiles
  add column if not exists phone text,
  add column if not exists job_title text,
  add column if not exists avatar_url text;

drop policy if exists organizations_update_admin on public.organizations;

-- Admins can update their organization profile
create policy organizations_update_admin
  on public.organizations for update
  to authenticated
  using (
    id in (
      select org_id from public.profiles
      where id = auth.uid() and role = 'Admin'
    )
  )
  with check (
    id in (
      select org_id from public.profiles
      where id = auth.uid() and role = 'Admin'
    )
  );

grant update on table public.organizations to authenticated;
