-- Platform-wide ops settings (maintenance banner, etc.).
-- Singleton row id = 1. Platform admins write via service role; tenants read message only.

create table if not exists public.platform_settings (
  id int primary key default 1 check (id = 1),
  maintenance_enabled boolean not null default false,
  maintenance_message text not null default '',
  maintenance_severity text not null default 'info'
    check (maintenance_severity in ('info', 'warning', 'critical')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.platform_settings is
  'Singleton platform ops settings. Row id must always be 1.';

insert into public.platform_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

-- Tenants may read the banner so login/app shells can show it without a service call.
create policy platform_settings_select_authenticated
  on public.platform_settings
  for select to authenticated
  using (true);

-- anon can read too (login / status pages before sign-in)
create policy platform_settings_select_anon
  on public.platform_settings
  for select to anon
  using (true);

revoke all on public.platform_settings from public;
grant select on public.platform_settings to anon, authenticated;
grant all on public.platform_settings to postgres, service_role;
