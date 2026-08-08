-- Phase 2: data integrity, cron lease, claim helpers, profile identity lock, channel secret ACL.
-- Run in Supabase SQL Editor after 029.
-- If unique indexes fail, inspect remaining duplicates then re-run the index statements.

-- ---------------------------------------------------------------------------
-- 0) Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_org_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('Admin'::public.app_role, 'Manager'::public.app_role)
  );
$$;

revoke all on function public.is_org_admin() from public;
grant execute on function public.is_org_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1) Dedupe external lead IDs (keep oldest row)
-- ---------------------------------------------------------------------------

delete from public.leads a
using public.leads b
where a.id > b.id
  and a.org_id = b.org_id
  and coalesce(nullif(trim(a.metadata->>'brainmine_id'), ''), '') <> ''
  and a.metadata->>'brainmine_id' = b.metadata->>'brainmine_id';

delete from public.leads a
using public.leads b
where a.id > b.id
  and a.org_id = b.org_id
  and coalesce(nullif(trim(a.metadata->>'indiamart_query_id'), ''), '') <> ''
  and a.metadata->>'indiamart_query_id' = b.metadata->>'indiamart_query_id';

delete from public.leads a
using public.leads b
where a.id > b.id
  and a.org_id = b.org_id
  and coalesce(nullif(trim(a.metadata->>'tradeindia_rfi_id'), ''), '') <> ''
  and a.metadata->>'tradeindia_rfi_id' = b.metadata->>'tradeindia_rfi_id';

create unique index if not exists leads_unique_brainmine_id
  on public.leads (org_id, (metadata->>'brainmine_id'))
  where coalesce(nullif(trim(metadata->>'brainmine_id'), ''), '') <> '';

create unique index if not exists leads_unique_indiamart_query_id
  on public.leads (org_id, (metadata->>'indiamart_query_id'))
  where coalesce(nullif(trim(metadata->>'indiamart_query_id'), ''), '') <> '';

create unique index if not exists leads_unique_tradeindia_rfi_id
  on public.leads (org_id, (metadata->>'tradeindia_rfi_id'))
  where coalesce(nullif(trim(metadata->>'tradeindia_rfi_id'), ''), '') <> '';

-- ---------------------------------------------------------------------------
-- 2) Dedupe provider message IDs (keep oldest)
-- ---------------------------------------------------------------------------

delete from public.messages a
using public.messages b
where a.id > b.id
  and a.org_id = b.org_id
  and coalesce(nullif(trim(a.metadata->>'wa_message_id'), ''), '') <> ''
  and a.metadata->>'wa_message_id' = b.metadata->>'wa_message_id';

delete from public.messages a
using public.messages b
where a.id > b.id
  and a.org_id = b.org_id
  and coalesce(nullif(trim(a.metadata->>'fb_message_id'), ''), '') <> ''
  and a.metadata->>'fb_message_id' = b.metadata->>'fb_message_id';

delete from public.messages a
using public.messages b
where a.id > b.id
  and a.org_id = b.org_id
  and coalesce(nullif(trim(a.metadata->>'ig_message_id'), ''), '') <> ''
  and a.metadata->>'ig_message_id' = b.metadata->>'ig_message_id';

delete from public.messages a
using public.messages b
where a.id > b.id
  and a.org_id = b.org_id
  and coalesce(nullif(trim(a.metadata->>'email_message_id'), ''), '') <> ''
  and a.metadata->>'email_message_id' = b.metadata->>'email_message_id';

create unique index if not exists messages_unique_wa_message_id
  on public.messages (org_id, (metadata->>'wa_message_id'))
  where coalesce(nullif(trim(metadata->>'wa_message_id'), ''), '') <> '';

create unique index if not exists messages_unique_fb_message_id
  on public.messages (org_id, (metadata->>'fb_message_id'))
  where coalesce(nullif(trim(metadata->>'fb_message_id'), ''), '') <> '';

create unique index if not exists messages_unique_ig_message_id
  on public.messages (org_id, (metadata->>'ig_message_id'))
  where coalesce(nullif(trim(metadata->>'ig_message_id'), ''), '') <> '';

create unique index if not exists messages_unique_email_message_id
  on public.messages (org_id, (metadata->>'email_message_id'))
  where coalesce(nullif(trim(metadata->>'email_message_id'), ''), '') <> '';

-- ---------------------------------------------------------------------------
-- 3) Cron lease (safe with pooled connections)
-- ---------------------------------------------------------------------------

create table if not exists public.cron_leases (
  lock_key text primary key,
  holder text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.cron_leases enable row level security;

revoke all on table public.cron_leases from public, anon, authenticated;
grant all on table public.cron_leases to postgres, service_role;

create or replace function public.try_acquire_cron_lease(
  p_key text,
  p_holder text,
  p_ttl_seconds int default 240
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ttl int := greatest(30, least(coalesce(p_ttl_seconds, 240), 900));
  n int;
begin
  delete from public.cron_leases
  where lock_key = p_key
    and expires_at < now();

  insert into public.cron_leases (lock_key, holder, acquired_at, expires_at)
  values (p_key, p_holder, now(), now() + make_interval(secs => ttl))
  on conflict (lock_key) do update
    set holder = excluded.holder,
        acquired_at = now(),
        expires_at = excluded.expires_at
    where public.cron_leases.expires_at < now();

  get diagnostics n = row_count;
  return n > 0;
end;
$$;

create or replace function public.release_cron_lease(
  p_key text,
  p_holder text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from public.cron_leases
  where lock_key = p_key
    and holder = p_holder;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.try_acquire_cron_lease(text, text, int) from public;
revoke all on function public.release_cron_lease(text, text) from public;
grant execute on function public.try_acquire_cron_lease(text, text, int) to service_role;
grant execute on function public.release_cron_lease(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4) Claim-before-act helpers
-- ---------------------------------------------------------------------------

create or replace function public.claim_due_follow_up_leads(
  p_org_id uuid,
  p_limit int default 40
)
returns setof public.leads
language plpgsql
security definer
set search_path = public
as $$
declare
  lim int := greatest(1, least(coalesce(p_limit, 40), 200));
  now_ts timestamptz := now();
begin
  return query
  with picked as (
    select l.id
    from public.leads l
    where l.org_id = p_org_id
      and l.next_follow_up_at is not null
      and l.next_follow_up_at <= now_ts
      and l.status not in ('Won', 'Lost')
    order by l.next_follow_up_at asc
    for update skip locked
    limit lim
  )
  update public.leads lead
  set next_follow_up_at = null,
      last_activity_at = now_ts,
      metadata = coalesce(lead.metadata, '{}'::jsonb)
        || jsonb_build_object('last_follow_up_fired_at', to_jsonb(now_ts))
  from picked
  where lead.id = picked.id
  returning lead.*;
end;
$$;

create or replace function public.claim_scheduled_automation_steps(
  p_org_id uuid,
  p_limit int default 40
)
returns setof public.automation_scheduled_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  lim int := greatest(1, least(coalesce(p_limit, 40), 200));
  now_ts timestamptz := now();
begin
  -- Reclaim stale running steps (> 20 min)
  update public.automation_scheduled_steps
  set status = 'pending',
      updated_at = now_ts,
      last_error = coalesce(last_error, 'reclaimed stale running claim')
  where org_id = p_org_id
    and status = 'running'
    and updated_at < now_ts - interval '20 minutes';

  return query
  with picked as (
    select s.id
    from public.automation_scheduled_steps s
    where s.org_id = p_org_id
      and s.status = 'pending'
      and s.run_at <= now_ts
    order by s.run_at asc
    for update skip locked
    limit lim
  )
  update public.automation_scheduled_steps step
  set status = 'running',
      updated_at = now_ts
  from picked
  where step.id = picked.id
  returning step.*;
end;
$$;

create or replace function public.claim_automation_approval(
  p_approval_id uuid,
  p_resolved_by uuid default null
)
returns setof public.automation_approvals
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Soft claim: set resolved_at while still pending; loser gets zero rows.
  return query
  update public.automation_approvals a
  set resolved_at = now(),
      resolved_by = p_resolved_by
  where a.id = p_approval_id
    and a.status = 'pending'
    and a.resolved_at is null
  returning a.*;
end;
$$;

revoke all on function public.claim_due_follow_up_leads(uuid, int) from public;
revoke all on function public.claim_scheduled_automation_steps(uuid, int) from public;
revoke all on function public.claim_automation_approval(uuid, uuid) from public;
grant execute on function public.claim_due_follow_up_leads(uuid, int) to service_role;
grant execute on function public.claim_scheduled_automation_steps(uuid, int) to service_role;
grant execute on function public.claim_automation_approval(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5) Lock profiles.role / org_id (no client escalation)
-- ---------------------------------------------------------------------------

create or replace function public.protect_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.role is distinct from old.role or new.org_id is distinct from old.org_id then
      -- service_role JWT / table owner path only (SQL editor, server with service key)
      if coalesce(auth.role(), '') = 'service_role' then
        return new;
      end if;
      raise exception 'profiles.role and profiles.org_id cannot be changed via client API'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_identity on public.profiles;
create trigger profiles_protect_identity
  before update on public.profiles
  for each row execute function public.protect_profile_identity();

-- ---------------------------------------------------------------------------
-- 6) Channel secrets ACL — hide config from non-admins at the column level
-- ---------------------------------------------------------------------------

revoke all on table public.channels from authenticated;
grant select (
  id, org_id, type, name, status, health, detail, is_enabled, created_at, updated_at
) on table public.channels to authenticated;
grant insert on table public.channels to authenticated;
grant update (
  name, detail, status, health, is_enabled, updated_at
) on table public.channels to authenticated;
grant delete on table public.channels to authenticated;

-- Keep org membership RLS; tighten write of channel rows to Admin/Manager
drop policy if exists channels_org_all on public.channels;

create policy channels_select_member on public.channels
  for select to authenticated
  using (public.is_org_member(org_id));

create policy channels_insert_admin on public.channels
  for insert to authenticated
  with check (public.is_org_member(org_id) and public.is_org_admin());

create policy channels_update_admin on public.channels
  for update to authenticated
  using (public.is_org_member(org_id) and public.is_org_admin())
  with check (public.is_org_member(org_id) and public.is_org_admin());

create policy channels_delete_admin on public.channels
  for delete to authenticated
  using (public.is_org_member(org_id) and public.is_org_admin());

create or replace function public.get_channel_config(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb;
begin
  if not public.is_org_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select c.config into v_cfg
  from public.channels c
  where c.id = p_channel_id
    and public.is_org_member(c.org_id);

  if not found then
    raise exception 'Channel not found';
  end if;

  return coalesce(v_cfg, '{}'::jsonb);
end;
$$;

create or replace function public.set_channel_config(p_channel_id uuid, p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb;
begin
  if not public.is_org_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  update public.channels c
  set config = coalesce(p_config, '{}'::jsonb),
      updated_at = now()
  where c.id = p_channel_id
    and public.is_org_member(c.org_id)
  returning c.config into v_cfg;

  if not found then
    raise exception 'Channel not found';
  end if;

  return coalesce(v_cfg, '{}'::jsonb);
end;
$$;

revoke all on function public.get_channel_config(uuid) from public;
revoke all on function public.set_channel_config(uuid, jsonb) from public;
grant execute on function public.get_channel_config(uuid) to authenticated, service_role;
grant execute on function public.set_channel_config(uuid, jsonb) to authenticated, service_role;
