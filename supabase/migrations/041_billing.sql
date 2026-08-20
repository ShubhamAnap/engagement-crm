-- Phase 4: plan tiers, usage caps bookkeeping, BYOK secrets, billing audit log.
-- Run in Supabase SQL Editor after 040.

alter table public.organizations
  add column if not exists plan_tier text not null default 'free',
  add column if not exists billing_status text not null default 'active',
  add column if not exists billing_period_end timestamptz,
  add column if not exists razorpay_subscription_id text,
  add column if not exists razorpay_customer_id text,
  add column if not exists stripe_customer_id text;

comment on column public.organizations.plan_tier is 'free | starter | pro | enterprise — drives hard usage caps';
comment on column public.organizations.billing_status is 'active | past_due | cancelled';

-- Backfill from legacy plan display string
update public.organizations
set plan_tier = case
  when lower(plan) = 'enterprise' then 'enterprise'
  when lower(plan) = 'starter' then 'starter'
  when lower(plan) = 'pro' then 'pro'
  else 'free'
end
where plan_tier = 'free' or plan_tier is null;

-- Per-org OpenAI BYOK (service role only — never expose to browser)
create table if not exists public.org_secrets (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  openai_api_key text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.org_secrets is 'Org-owned API keys. Readable only via service role.';

alter table public.org_secrets enable row level security;

grant all on table public.org_secrets to postgres, service_role;

-- Billing webhook audit (service role only)
create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete set null,
  provider text not null default 'razorpay',
  event_type text not null,
  external_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists billing_events_org_created_idx
  on public.billing_events (org_id, created_at desc);

alter table public.billing_events enable row level security;

grant all on table public.billing_events to postgres, service_role;
