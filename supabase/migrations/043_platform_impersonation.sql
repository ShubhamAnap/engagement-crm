-- Phase: platform tenant impersonation (support mode).
-- When a platform admin starts a session, current_org_id() / is_org_member() / is_org_admin()
-- resolve to the target workspace so browser RLS + server staff auth see that org.

create table if not exists public.platform_impersonation_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  target_org_id uuid not null references public.organizations (id) on delete cascade,
  home_org_id uuid references public.organizations (id) on delete set null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  note text
);

create index if not exists platform_impersonation_expires_idx
  on public.platform_impersonation_sessions (expires_at);

comment on table public.platform_impersonation_sessions is
  'Active support impersonation: platform admin acts as target_org_id until expiry';

alter table public.platform_impersonation_sessions enable row level security;

-- User can read their own active session (for client UI).
drop policy if exists platform_impersonation_select_own on public.platform_impersonation_sessions;
create policy platform_impersonation_select_own on public.platform_impersonation_sessions
  for select to authenticated
  using (user_id = auth.uid() and expires_at > now());

grant select on table public.platform_impersonation_sessions to authenticated;
grant all on table public.platform_impersonation_sessions to postgres, service_role;

-- ---------------------------------------------------------------------------
-- RLS helpers: honor active platform impersonation
-- ---------------------------------------------------------------------------

create or replace function public.active_impersonation_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.target_org_id
  from public.platform_impersonation_sessions s
  where s.user_id = auth.uid()
    and s.expires_at > now()
  limit 1
$$;

revoke all on function public.active_impersonation_org_id() from public;
grant execute on function public.active_impersonation_org_id() to authenticated, service_role;

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.active_impersonation_org_id(),
    (select org_id from public.profiles where id = auth.uid() limit 1)
  )
$$;

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.profiles
      where id = auth.uid() and org_id = target_org
    )
    or exists (
      select 1 from public.platform_impersonation_sessions s
      where s.user_id = auth.uid()
        and s.target_org_id = target_org
        and s.expires_at > now()
    )
$$;

create or replace function public.is_org_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.platform_impersonation_sessions s
      where s.user_id = auth.uid()
        and s.expires_at > now()
    )
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('Admin'::public.app_role, 'Manager'::public.app_role)
    )
$$;

-- Older policies that checked profiles.org_id directly — switch to is_org_member / current_org_id
-- so support mode can see the target tenant.

do $$ begin
  -- ai_tools (021)
  if to_regclass('public.ai_tools') is not null then
    execute 'drop policy if exists ai_tools_org_all on public.ai_tools';
    execute $p$
      create policy ai_tools_org_all on public.ai_tools
        for all to authenticated
        using (public.is_org_member(org_id))
        with check (public.is_org_member(org_id))
    $p$;
  end if;
exception when others then
  raise notice 'ai_tools policy skip: %', sqlerrm;
end $$;

do $$ begin
  if to_regclass('public.sales_person_directory') is not null then
    execute 'drop policy if exists sales_person_directory_org on public.sales_person_directory';
    execute $p$
      create policy sales_person_directory_org on public.sales_person_directory
        for all to authenticated
        using (public.is_org_member(org_id))
        with check (public.is_org_member(org_id))
    $p$;
  end if;
exception when others then
  raise notice 'sales_person_directory policy skip: %', sqlerrm;
end $$;

do $$ begin
  if to_regclass('public.sizing_formulas') is not null then
    execute 'drop policy if exists sizing_formulas_org_all on public.sizing_formulas';
    execute $p$
      create policy sizing_formulas_org_all on public.sizing_formulas
        for all to authenticated
        using (public.is_org_member(org_id))
        with check (public.is_org_member(org_id))
    $p$;
  end if;
exception when others then
  raise notice 'sizing_formulas policy skip: %', sqlerrm;
end $$;

do $$ begin
  if to_regclass('public.load_applications') is not null then
    execute 'drop policy if exists load_applications_org_all on public.load_applications';
    execute $p$
      create policy load_applications_org_all on public.load_applications
        for all to authenticated
        using (public.is_org_member(org_id))
        with check (public.is_org_member(org_id))
    $p$;
  end if;
exception when others then
  raise notice 'load_applications policy skip: %', sqlerrm;
end $$;

do $$ begin
  if to_regclass('public.wa_message_templates') is not null then
    execute 'drop policy if exists wa_templates_org on public.wa_message_templates';
    execute $p$
      create policy wa_templates_org on public.wa_message_templates
        for all to authenticated
        using (public.is_org_member(org_id))
        with check (public.is_org_member(org_id))
    $p$;
  end if;
exception when others then
  raise notice 'wa_templates policy skip: %', sqlerrm;
end $$;

do $$ begin
  if to_regclass('public.broadcasts') is not null then
    execute 'drop policy if exists broadcasts_org on public.broadcasts';
    execute $p$
      create policy broadcasts_org on public.broadcasts
        for all to authenticated
        using (public.is_org_member(org_id))
        with check (public.is_org_member(org_id))
    $p$;
  end if;
exception when others then
  raise notice 'broadcasts policy skip: %', sqlerrm;
end $$;

do $$ begin
  if to_regclass('public.broadcast_recipients') is not null then
    execute 'drop policy if exists broadcast_recipients_org on public.broadcast_recipients';
    execute $p$
      create policy broadcast_recipients_org on public.broadcast_recipients
        for all to authenticated
        using (public.is_org_member(org_id))
        with check (public.is_org_member(org_id))
    $p$;
  end if;
exception when others then
  raise notice 'broadcast_recipients policy skip: %', sqlerrm;
end $$;
