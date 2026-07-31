-- Automation v2 Step 2 — notifications table + starter playbooks
-- Run AFTER 012_automation_follow_up_trigger.sql has committed.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  body text not null default '',
  href text,
  lead_id uuid references public.leads (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notifications_org_created_idx
  on public.notifications (org_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_org_all on public.notifications;
create policy notifications_org_all on public.notifications
  for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

grant all on table public.notifications to postgres, service_role;
grant select, insert, update, delete on table public.notifications to authenticated;

-- Index for due follow-up cron
create index if not exists leads_next_follow_up_idx
  on public.leads (org_id, next_follow_up_at)
  where next_follow_up_at is not null;

-- Upsert / refresh playbooks for EnerTech org
insert into public.automations (org_id, name, description, status, trigger_type, trigger_config, actions)
select * from (values
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Follow-up due → Alert sales',
    'When a scheduled follow-up time passes, notify the team and note the lead.',
    'Live'::public.automation_status,
    'follow_up_due'::public.automation_trigger,
    '{}'::jsonb,
    '[
      {"type":"notify_team","title":"Follow-up due","body":"Lead {{name}} ({{company}}) is due for follow-up.","href":"/leads"},
      {"type":"add_lead_note","note":"Auto: follow-up due — sales should call/WA today"}
    ]'::jsonb
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Proposal → WA reminder + alert',
    'When lead moves to Proposal, schedule 48h follow-up, notify team, and queue a WhatsApp template (requires approved template name).',
    'Live'::public.automation_status,
    'lead_status_changed'::public.automation_trigger,
    '{"to_status":"Proposal"}'::jsonb,
    '[
      {"type":"set_follow_up_hours","hours":48},
      {"type":"notify_team","title":"Proposal stage","body":"{{name}} moved to Proposal — chase in 48h.","href":"/leads"},
      {"type":"send_whatsapp_template","templateName":"followup_01","language":"en","bodyParams":["{{name}}"]},
      {"type":"add_lead_note","note":"Auto: Proposal playbook — WA template followup_01 attempted"}
    ]'::jsonb
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Escalation → Notify Human Support',
    'On chat escalation: tag, assign queue, system message, and in-app team alert.',
    'Live'::public.automation_status,
    'conversation_escalated'::public.automation_trigger,
    '{}'::jsonb,
    '[
      {"type":"tag_conversation","tag":"Escalated"},
      {"type":"set_assignee_label","label":"Human Support · Priority"},
      {"type":"add_system_message","body":"Automation: conversation escalated — human follow-up required."},
      {"type":"notify_team","title":"Escalation","body":"A conversation needs Human Support.","href":"/human-support"}
    ]'::jsonb
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'IndiaMART → Fast chase + notify',
    'IndiaMART enquiry: High priority, Contacted, 4h follow-up, team alert.',
    'Live'::public.automation_status,
    'indiamart_lead'::public.automation_trigger,
    '{"source":"indiamart"}'::jsonb,
    '[
      {"type":"set_lead_priority","priority":"High"},
      {"type":"set_lead_status","status":"Contacted"},
      {"type":"set_follow_up_hours","hours":4},
      {"type":"notify_team","title":"IndiaMART lead","body":"New IndiaMART enquiry: {{name}} / {{company}}","href":"/leads"},
      {"type":"add_lead_note","note":"Auto: IndiaMART — remarketing chase within 4h"}
    ]'::jsonb
  )
) as v(org_id, name, description, status, trigger_type, trigger_config, actions)
where not exists (
  select 1 from public.automations a
  where a.org_id = v.org_id and a.name = v.name
);

-- Refresh actions on older seed names if still the original simple versions
update public.automations
set
  description = 'On chat escalation: tag, assign queue, system message, and in-app team alert.',
  actions = '[
    {"type":"tag_conversation","tag":"Escalated"},
    {"type":"set_assignee_label","label":"Human Support · Priority"},
    {"type":"add_system_message","body":"Automation: conversation escalated — human follow-up required."},
    {"type":"notify_team","title":"Escalation","body":"A conversation needs Human Support.","href":"/human-support"}
  ]'::jsonb,
  updated_at = now()
where org_id = 'a0000000-0000-4000-8000-000000000001'
  and name = 'Escalation → Human Queue Alert';

update public.automations
set
  description = 'On IndiaMART sync: High priority, Contacted, 4h follow-up, team alert.',
  actions = '[
    {"type":"set_lead_priority","priority":"High"},
    {"type":"set_lead_status","status":"Contacted"},
    {"type":"set_follow_up_hours","hours":4},
    {"type":"notify_team","title":"IndiaMART lead","body":"New IndiaMART enquiry: {{name}} / {{company}}","href":"/leads"},
    {"type":"add_lead_note","note":"Auto: IndiaMART — remarketing chase within 4h"}
  ]'::jsonb,
  updated_at = now()
where org_id = 'a0000000-0000-4000-8000-000000000001'
  and name = 'IndiaMART Lead → Remarketing';

update public.automations
set
  description = 'When lead moves to Proposal: 48h follow-up, team alert, WhatsApp template followup_01.',
  actions = '[
    {"type":"set_follow_up_hours","hours":48},
    {"type":"notify_team","title":"Proposal stage","body":"{{name}} moved to Proposal — chase in 48h.","href":"/leads"},
    {"type":"send_whatsapp_template","templateName":"followup_01","language":"en","bodyParams":["{{name}}"]},
    {"type":"add_lead_note","note":"Auto: Proposal playbook — WA template followup_01 attempted"}
  ]'::jsonb,
  updated_at = now()
where org_id = 'a0000000-0000-4000-8000-000000000001'
  and name = 'Proposal Sent → 48h Reminder';
