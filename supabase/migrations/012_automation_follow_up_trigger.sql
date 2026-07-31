-- Automation v2 Step 1 — new trigger only (run alone, then 012b)
-- Adds follow_up_due for scheduled next_follow_up_at processing.

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'automation_trigger'
      and e.enumlabel = 'follow_up_due'
  ) then
    alter type public.automation_trigger add value 'follow_up_due';
  end if;
end $$;
