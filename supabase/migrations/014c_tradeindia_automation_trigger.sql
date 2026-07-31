-- Optional: dedicated automation trigger for TradeIndia leads
-- Run after 014 / 014b (alone).

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'automation_trigger'
      and e.enumlabel = 'tradeindia_lead'
  ) then
    alter type public.automation_trigger add value 'tradeindia_lead';
  end if;
end $$;
