-- TradeIndia channel row — run AFTER 014_tradeindia_channel.sql has committed

insert into public.channels (org_id, type, name, status, health, detail, is_enabled)
values (
  'a0000000-0000-4000-8000-000000000001',
  'tradeindia',
  'TradeIndia',
  'Disconnected',
  0,
  'Inquiry API (My Inquiry API)',
  false
)
on conflict (org_id, type) do nothing;
