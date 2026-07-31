-- TradeIndia channel — Step 1 alone (enum). Then run 014b.

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'channel_type'
      and e.enumlabel = 'tradeindia'
  ) then
    alter type public.channel_type add value 'tradeindia';
  end if;
end $$;
