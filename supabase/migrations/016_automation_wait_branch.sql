-- Automation Phase C — Wait delays + scheduled continuation after Wait
-- Run after 012b / 013 as needed.

create table if not exists public.automation_scheduled_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  automation_id uuid not null references public.automations (id) on delete cascade,
  automation_name text not null default '',
  lead_id uuid references public.leads (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  context jsonb not null default '{}'::jsonb,
  remaining_actions jsonb not null default '[]'::jsonb,
  run_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'error', 'cancelled')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automation_scheduled_due_idx
  on public.automation_scheduled_steps (org_id, run_at)
  where status = 'pending';

alter table public.automation_scheduled_steps enable row level security;

drop policy if exists automation_scheduled_org_all on public.automation_scheduled_steps;
create policy automation_scheduled_org_all on public.automation_scheduled_steps
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

grant all on table public.automation_scheduled_steps to postgres, service_role;
grant select, insert, update, delete on table public.automation_scheduled_steps to authenticated;
