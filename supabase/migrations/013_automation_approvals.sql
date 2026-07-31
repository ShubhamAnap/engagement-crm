-- Automation approval queue — campaigns wait for human Approve/Reject
-- Run after 012 / 012b.

alter table public.automations
  add column if not exists requires_approval boolean not null default true;

comment on column public.automations.requires_approval is
  'When true, matching triggers enqueue for Approve/Reject instead of running immediately';

-- Existing workflows: require approval (campaigns / follow-ups / remarketing)
update public.automations
set requires_approval = true
where requires_approval is distinct from true;

create type public.automation_approval_status as enum (
  'pending',
  'approved',
  'rejected',
  'expired'
);

create table if not exists public.automation_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  automation_id uuid not null references public.automations (id) on delete cascade,
  automation_name text not null,
  trigger_type text not null,
  status public.automation_approval_status not null default 'pending',
  goal text not null default '',
  summary text not null default '',
  context jsonb not null default '{}'::jsonb,
  actions_snapshot jsonb not null default '[]'::jsonb,
  lead_id uuid references public.leads (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists automation_approvals_pending_idx
  on public.automation_approvals (org_id, status, created_at desc)
  where status = 'pending';

create index if not exists automation_approvals_auto_idx
  on public.automation_approvals (automation_id, created_at desc);

alter table public.automation_approvals enable row level security;

drop policy if exists automation_approvals_org_all on public.automation_approvals;
create policy automation_approvals_org_all on public.automation_approvals
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

grant all on table public.automation_approvals to postgres, service_role;
grant select, insert, update, delete on table public.automation_approvals to authenticated;
