-- WordPress channel row — run AFTER 034_wordpress_channel.sql Step 1 has committed

insert into public.channels (org_id, type, name, status, health, detail, is_enabled)
values (
  'a0000000-0000-4000-8000-000000000001',
  'wordpress',
  'WordPress / WooCommerce',
  'Disconnected',
  0,
  'Product catalog pull (WordPress is source of truth)',
  false
)
on conflict (org_id, type) do nothing;
