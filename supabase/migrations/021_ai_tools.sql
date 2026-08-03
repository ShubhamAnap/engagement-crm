-- Global AI tools catalog (Calculator, Web search, …).
-- Agents opt in via agents.config.allowed_tools = ['calculator','web_search',...]

create table if not exists public.ai_tools (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  is_enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create index if not exists ai_tools_org_id_idx on public.ai_tools (org_id);

drop trigger if exists ai_tools_updated_at on public.ai_tools;
create trigger ai_tools_updated_at
  before update on public.ai_tools
  for each row execute function public.handle_updated_at();

alter table public.ai_tools enable row level security;

drop policy if exists ai_tools_org_all on public.ai_tools;
create policy ai_tools_org_all on public.ai_tools
  for all
  using (org_id in (select org_id from public.profiles where id = auth.uid()))
  with check (org_id in (select org_id from public.profiles where id = auth.uid()));

grant select, insert, update, delete on public.ai_tools to authenticated;
grant all on public.ai_tools to postgres, service_role;

insert into public.ai_tools (org_id, key, name, description, is_enabled)
values
  (
    'a0000000-0000-4000-8000-000000000001',
    'calculator',
    'Calculator',
    'Accurate math and UPS/battery runtime estimates (kVA, load %, Ah, minutes). Prefer this over guessing numbers.',
    true
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'web_search',
    'Web search',
    'Optional public web lookup. Prefer Knowledge Base for EnerTech specs; use only for general public facts.',
    false
  )
on conflict (org_id, key) do nothing;
