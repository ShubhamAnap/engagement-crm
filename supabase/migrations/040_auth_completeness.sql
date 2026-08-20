-- Phase 3: invites, org disable, signup rate-limit bookkeeping

alter table public.organizations
  add column if not exists is_active boolean not null default true,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_reason text;

comment on column public.organizations.is_active is 'When false, all members are blocked from the app';

create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  full_name text,
  role public.app_role not null default 'Agent',
  permissions jsonb not null default '[]'::jsonb,
  invited_by uuid references public.profiles (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index if not exists org_invites_pending_email_idx
  on public.org_invites (lower(email))
  where status = 'pending';

create index if not exists org_invites_org_idx on public.org_invites (org_id, status);

alter table public.org_invites enable row level security;

create policy org_invites_admin_select
  on public.org_invites for select
  to authenticated
  using (
    org_id in (
      select org_id from public.profiles
      where id = auth.uid() and role = 'Admin'
    )
  );

-- Signup abuse tracking (service role only)
create table if not exists public.signup_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists signup_attempts_ip_created_idx
  on public.signup_attempts (ip_hash, created_at desc);

alter table public.signup_attempts enable row level security;

-- Platform-wide email uniqueness on profiles (best-effort; run once)
create unique index if not exists profiles_email_unique_idx
  on public.profiles (lower(email));
