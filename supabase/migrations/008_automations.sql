-- Automations (workflows) — run in Supabase SQL Editor
-- Safe as one query: creates new types (not ADD VALUE on existing enums)

create type public.automation_status as enum ('Live', 'Paused', 'Draft');

create type public.automation_trigger as enum (
  'lead_created',
  'indiamart_lead',
  'conversation_escalated',
  'lead_status_changed'
);

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text,
  status public.automation_status not null default 'Draft',
  trigger_type public.automation_trigger not null,
  trigger_config jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  run_count integer not null default 0,
  success_count integer not null default 0,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automations_org_id_idx on public.automations (org_id);
create index if not exists automations_trigger_idx on public.automations (org_id, trigger_type, status);

create trigger automations_updated_at
  before update on public.automations
  for each row execute function public.handle_updated_at();

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  automation_id uuid not null references public.automations (id) on delete cascade,
  status text not null default 'success',
  trigger_type text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists automation_runs_automation_idx
  on public.automation_runs (automation_id, created_at desc);
create index if not exists automation_runs_org_idx
  on public.automation_runs (org_id, created_at desc);

alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;

drop policy if exists automations_org_all on public.automations;
drop policy if exists automation_runs_org_all on public.automation_runs;

create policy automations_org_all on public.automations
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

create policy automation_runs_org_all on public.automation_runs
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

grant all on table public.automations to postgres, service_role;
grant select, insert, update, delete on table public.automations to authenticated;
grant all on table public.automation_runs to postgres, service_role;
grant select, insert, update, delete on table public.automation_runs to authenticated;

-- Seed starter workflows only if none exist for EnerTech org
insert into public.automations (org_id, name, description, status, trigger_type, trigger_config, actions)
select * from (values
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'New Lead → Qualify & Follow-up',
    'When a lead is created, raise priority and schedule a 24h follow-up.',
    'Live'::public.automation_status,
    'lead_created'::public.automation_trigger,
    '{}'::jsonb,
    '[{"type":"set_lead_priority","priority":"High"},{"type":"set_follow_up_hours","hours":24},{"type":"add_lead_note","note":"Auto: queued for sales qualification"}]'::jsonb
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'IndiaMART Lead → Remarketing',
    'On IndiaMART sync, mark lead for remarketing follow-up within 4 hours.',
    'Live'::public.automation_status,
    'indiamart_lead'::public.automation_trigger,
    '{}'::jsonb,
    '[{"type":"set_lead_priority","priority":"High"},{"type":"set_follow_up_hours","hours":4},{"type":"set_lead_status","status":"Contacted"},{"type":"add_lead_note","note":"Auto: IndiaMART enquiry — remarketing sequence started"}]'::jsonb
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Escalation → Human Queue Alert',
    'When a chat is escalated, tag the thread and set assignee label for Human Support.',
    'Live'::public.automation_status,
    'conversation_escalated'::public.automation_trigger,
    '{}'::jsonb,
    '[{"type":"tag_conversation","tag":"Escalated"},{"type":"set_assignee_label","label":"Human Support · Priority"},{"type":"add_system_message","body":"Automation: conversation escalated — human follow-up required."}]'::jsonb
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Proposal Sent → 48h Reminder',
    'When lead moves to Proposal, schedule a 48-hour follow-up reminder.',
    'Live'::public.automation_status,
    'lead_status_changed'::public.automation_trigger,
    '{"to_status":"Proposal"}'::jsonb,
    '[{"type":"set_follow_up_hours","hours":48},{"type":"add_lead_note","note":"Auto: 48h reminder after quotation/proposal"}]'::jsonb
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Warranty Renewal Campaign',
    'Draft workflow — enable when warranty data is connected.',
    'Draft'::public.automation_status,
    'lead_created'::public.automation_trigger,
    '{}'::jsonb,
    '[{"type":"add_lead_note","note":"Placeholder: warranty renewal campaign"}]'::jsonb
  )
) as v(org_id, name, description, status, trigger_type, trigger_config, actions)
where not exists (
  select 1 from public.automations a
  where a.org_id = 'a0000000-0000-4000-8000-000000000001'
);