-- Website chatbot: first-time visitor form submitted (with phone)
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'automation_trigger'
      and e.enumlabel = 'website_visitor_captured'
  ) then
    alter type public.automation_trigger add value 'website_visitor_captured';
  end if;
end $$;
