-- Phase 1 hardening: atomic claim of broadcast recipients + unique audience rows.
-- Claim prevents double-send when cron and UI overlap.
-- Unique indexes block duplicate phone/email rows per campaign (after any pre-existing dupes are cleaned).

alter table public.broadcast_recipients
  add column if not exists claimed_at timestamptz;

comment on column public.broadcast_recipients.claimed_at is
  'Set when status moves to sending; used to reclaim stale claims after crashes.';

create or replace function public.claim_broadcast_recipients(
  p_broadcast_id uuid,
  p_limit int default 500
)
returns setof public.broadcast_recipients
language plpgsql
security definer
set search_path = public
as $$
declare
  lim int := greatest(1, least(coalesce(p_limit, 500), 2000));
begin
  -- Reclaim stale sending rows (crashed / timed-out runners) before claiming.
  update public.broadcast_recipients
  set status = 'pending',
      claimed_at = null
  where broadcast_id = p_broadcast_id
    and status = 'sending'
    and claimed_at is not null
    and claimed_at < now() - interval '15 minutes';

  return query
  with picked as (
    select r.id
    from public.broadcast_recipients r
    where r.broadcast_id = p_broadcast_id
      and r.status = 'pending'
    order by r.created_at asc
    for update skip locked
    limit lim
  )
  update public.broadcast_recipients br
  set status = 'sending',
      claimed_at = now()
  from picked
  where br.id = picked.id
  returning br.*;
end;
$$;

revoke all on function public.claim_broadcast_recipients(uuid, int) from public;
grant execute on function public.claim_broadcast_recipients(uuid, int) to service_role;
grant execute on function public.claim_broadcast_recipients(uuid, int) to authenticated;

comment on function public.claim_broadcast_recipients(uuid, int) is
  'Atomically move pending broadcast_recipients to sending (SKIP LOCKED) for anti-double-send.';

-- WhatsApp-style rows (phone present, no email)
create unique index if not exists broadcast_recipients_unique_phone
  on public.broadcast_recipients (broadcast_id, phone)
  where phone is not null
    and length(trim(phone)) > 0
    and (email is null or length(trim(email)) = 0);

-- Email-style rows
create unique index if not exists broadcast_recipients_unique_email
  on public.broadcast_recipients (broadcast_id, lower(trim(email)))
  where email is not null
    and length(trim(email)) > 0;
