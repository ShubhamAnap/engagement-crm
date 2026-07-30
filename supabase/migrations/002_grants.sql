-- Fix API access after creating tables with "Automatically expose new tables" OFF.
-- Run in Supabase SQL Editor, then run: npm run seed:admin

grant usage on schema public to postgres, anon, authenticated, service_role;

grant all on table public.organizations to postgres, service_role;
grant select on table public.organizations to authenticated;

grant all on table public.profiles to postgres, service_role;
grant select, update on table public.profiles to authenticated;

grant usage, select on all sequences in schema public to postgres, anon, authenticated, service_role;

-- Ensure EnerTech org exists
insert into public.organizations (id, name, short_name, plan)
values (
  'a0000000-0000-4000-8000-000000000001',
  'EnerTech UPS Pvt. Ltd.',
  'EnerTech',
  'Enterprise'
)
on conflict (id) do nothing;
