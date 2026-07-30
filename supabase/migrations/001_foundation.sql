-- EnerTech Engage — Phase 0 foundation schema
-- Run this in Supabase Dashboard → SQL Editor → New query → Run

create extension if not exists "pgcrypto";

create type public.app_role as enum ('Admin', 'Manager', 'Agent', 'Sales');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text not null,
  plan text not null default 'Enterprise',
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  full_name text not null,
  role public.app_role not null default 'Agent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_org_id_idx on public.profiles (org_id);
create index profiles_email_idx on public.profiles (email);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;

-- Profiles: users can read/update their own row
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Organizations: members can read their org
create policy "organizations_select_member"
  on public.organizations for select
  to authenticated
  using (
    id in (select org_id from public.profiles where id = auth.uid())
  );

-- Keep profile email in sync helpers
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- Seed EnerTech organization (id is fixed so seed script can reference it)
insert into public.organizations (id, name, short_name, plan)
values (
  'a0000000-0000-4000-8000-000000000001',
  'EnerTech UPS Pvt. Ltd.',
  'EnerTech',
  'Enterprise'
)
on conflict (id) do nothing;

-- Expose tables to API roles (needed when "Automatically expose new tables" is OFF)
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on table public.organizations to postgres, service_role;
grant select on table public.organizations to authenticated;
grant all on table public.profiles to postgres, service_role;
grant select, update on table public.profiles to authenticated;
grant usage, select on all sequences in schema public to postgres, anon, authenticated, service_role;
