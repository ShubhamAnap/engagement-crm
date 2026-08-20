-- Phase 5: platform super-admins, audit log, platform suspension flag.

alter table public.organizations
  add column if not exists platform_suspended boolean not null default false,
  add column if not exists platform_notes text;

comment on column public.organizations.platform_suspended is 'Set by platform admin — distinct from org self-disable';

create table if not exists public.platform_admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is 'Users who can access /platform console (service role manages rows)';

alter table public.platform_admins enable row level security;

grant all on table public.platform_admins to postgres, service_role;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text,
  action text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_org_created_idx
  on public.audit_events (org_id, created_at desc);

create index if not exists audit_events_action_idx
  on public.audit_events (action, created_at desc);

comment on table public.audit_events is 'Append-only audit trail for team, billing, channels, platform actions';

alter table public.audit_events enable row level security;

drop policy if exists audit_events_org_admin_select on public.audit_events;
create policy audit_events_org_admin_select on public.audit_events
  for select to authenticated
  using (
    org_id in (
      select p.org_id from public.profiles p
      where p.id = auth.uid() and p.role = 'Admin'
    )
  );

grant select on table public.audit_events to authenticated;
grant all on table public.audit_events to postgres, service_role;
