-- API spend meter: OpenAI usage + WhatsApp outbound sends × editable rate card.
-- Run in Supabase SQL Editor after 036.
-- Dashboard (Admin) shows ₹ estimates. Logging is best-effort and must not block chat.

create table if not exists public.api_spend_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (
    kind in ('openai_chat', 'openai_embed', 'whatsapp_session', 'whatsapp_template')
  ),
  vendor text not null check (vendor in ('openai', 'meta')),
  model text,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  units numeric not null default 1,
  conversation_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists api_spend_events_org_created_idx
  on public.api_spend_events (org_id, created_at desc);

create index if not exists api_spend_events_org_kind_idx
  on public.api_spend_events (org_id, kind, created_at desc);

comment on table public.api_spend_events is
  'One row per billable OpenAI call or WhatsApp outbound send. Source of truth for Dashboard spend — not message-length guesses.';

create table if not exists public.cost_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null,
  amount numeric not null,
  unit text not null,
  notes text,
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create index if not exists cost_rates_org_idx on public.cost_rates (org_id);

drop trigger if exists cost_rates_updated_at on public.cost_rates;
create trigger cost_rates_updated_at
  before update on public.cost_rates
  for each row execute function public.handle_updated_at();

comment on table public.cost_rates is
  'Editable rate card. OpenAI = USD per 1M tokens; WhatsApp India = INR per delivered message (Meta per-message card); fx.usd_inr = INR per 1 USD.';

alter table public.api_spend_events enable row level security;
alter table public.cost_rates enable row level security;

-- Admins can read; only service_role writes events (chat path).
drop policy if exists api_spend_events_admin_select on public.api_spend_events;
create policy api_spend_events_admin_select on public.api_spend_events
  for select to authenticated
  using (
    public.is_org_member(org_id)
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.org_id = api_spend_events.org_id
        and p.role = 'Admin'
    )
  );

drop policy if exists cost_rates_admin_select on public.cost_rates;
create policy cost_rates_admin_select on public.cost_rates
  for select to authenticated
  using (
    public.is_org_member(org_id)
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.org_id = cost_rates.org_id
        and p.role = 'Admin'
    )
  );

grant select on table public.api_spend_events to authenticated;
grant all on table public.api_spend_events to postgres, service_role;

grant select on table public.cost_rates to authenticated;
grant all on table public.cost_rates to postgres, service_role;

-- Defaults for EnerTech (edit in SQL / later settings — do not overwrite on re-run).
insert into public.cost_rates (org_id, key, amount, unit, notes)
values
  (
    'a0000000-0000-4000-8000-000000000001',
    'openai.gpt-4o-mini.input',
    0.15,
    'usd_per_1m_tokens',
    'OpenAI gpt-4o-mini input (public list).'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'openai.gpt-4o-mini.output',
    0.60,
    'usd_per_1m_tokens',
    'OpenAI gpt-4o-mini output (public list).'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'openai.default.input',
    0.15,
    'usd_per_1m_tokens',
    'Fallback input rate when the model has no row.'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'openai.default.output',
    0.60,
    'usd_per_1m_tokens',
    'Fallback output rate when the model has no row.'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'openai.text-embedding-3-small',
    0.02,
    'usd_per_1m_tokens',
    'OpenAI embeddings (input only).'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'openai.default.embed',
    0.02,
    'usd_per_1m_tokens',
    'Fallback embedding rate.'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'whatsapp.in.marketing',
    0.8631,
    'inr_per_message',
    'Meta India marketing template, Jan 2026 card. Update when Meta revises.'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'whatsapp.in.utility',
    0.115,
    'inr_per_message',
    'Meta India utility/auth template. Free inside an open customer-service window (not modelled in phase 1).'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'whatsapp.in.service',
    0,
    'inr_per_message',
    'Session replies inside the 24h window — Meta does not charge.'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'fx.usd_inr',
    87,
    'inr_per_usd',
    'USD→INR for OpenAI. Set to the rate finance uses for the month.'
  )
on conflict (org_id, key) do nothing;
