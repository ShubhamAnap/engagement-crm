-- LLM gateway org settings (Admin UI under Settings → AI Gateway).
-- Run in Supabase SQL Editor after 037.
-- Does not change chat prompts. Chat still uses OpenAI until another provider is wired.

create table if not exists public.llm_gateway_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  provider text not null default 'openai',
  default_chat_model text not null default 'gpt-4o-mini',
  fallback_model text not null default '',
  summary_model text not null default 'gpt-4o-mini',
  embedding_model text not null default 'text-embedding-3-small',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

comment on table public.llm_gateway_settings is
  'Org-wide LLM gateway defaults. Per-agent model on /agents still overrides chat replies.';

drop trigger if exists llm_gateway_settings_updated_at on public.llm_gateway_settings;
create trigger llm_gateway_settings_updated_at
  before update on public.llm_gateway_settings
  for each row execute function public.handle_updated_at();

alter table public.llm_gateway_settings enable row level security;

drop policy if exists llm_gateway_settings_admin_select on public.llm_gateway_settings;
create policy llm_gateway_settings_admin_select on public.llm_gateway_settings
  for select to authenticated
  using (
    public.is_org_member(org_id)
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.org_id = llm_gateway_settings.org_id
        and p.role = 'Admin'
    )
  );

grant all on table public.llm_gateway_settings to postgres, service_role;
grant select on table public.llm_gateway_settings to authenticated;

insert into public.llm_gateway_settings (
  org_id, provider, default_chat_model, fallback_model, summary_model, embedding_model
)
values (
  'a0000000-0000-4000-8000-000000000001',
  'openai',
  'gpt-4o-mini',
  '',
  'gpt-4o-mini',
  'text-embedding-3-small'
)
on conflict (org_id) do nothing;
