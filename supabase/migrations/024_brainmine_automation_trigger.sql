-- Brainmine CRM: new non-duplicate lead synced
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'automation_trigger'
      and e.enumlabel = 'brainmine_lead'
  ) then
    alter type public.automation_trigger add value 'brainmine_lead';
  end if;
end $$;
