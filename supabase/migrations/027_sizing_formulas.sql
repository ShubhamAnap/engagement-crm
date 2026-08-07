-- EnerTech Engage — Sizing formulas + load applications (Intelligence → Formulas)
-- Run in Supabase SQL Editor after prior migrations.

create table if not exists public.sizing_formulas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  category text not null
    check (category in (
      'solar_home',
      'solar_industry',
      'inverter',
      'battery',
      'bess',
      'hybrid'
    )),
  description text,
  expression text not null,
  result_label text not null default 'Result',
  result_unit text not null default '',
  variables jsonb not null default '[]'::jsonb,
  notes text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sizing_formulas_org_idx
  on public.sizing_formulas (org_id, category, is_active);

drop trigger if exists sizing_formulas_updated_at on public.sizing_formulas;
create trigger sizing_formulas_updated_at
  before update on public.sizing_formulas
  for each row execute function public.handle_updated_at();

alter table public.sizing_formulas enable row level security;

drop policy if exists sizing_formulas_org_all on public.sizing_formulas;
create policy sizing_formulas_org_all on public.sizing_formulas
  for all
  using (org_id in (select org_id from public.profiles where id = auth.uid()))
  with check (org_id in (select org_id from public.profiles where id = auth.uid()));

grant select, insert, update, delete on public.sizing_formulas to authenticated;
grant all on public.sizing_formulas to postgres, service_role;

create table if not exists public.load_applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  watts numeric not null check (watts > 0),
  surge_watts numeric check (surge_watts is null or surge_watts > 0),
  category text not null default 'home'
    check (category in ('home', 'industry', 'both')),
  default_qty integer not null default 1 check (default_qty >= 0),
  notes text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists load_applications_org_idx
  on public.load_applications (org_id, category, is_active);

drop trigger if exists load_applications_updated_at on public.load_applications;
create trigger load_applications_updated_at
  before update on public.load_applications
  for each row execute function public.handle_updated_at();

alter table public.load_applications enable row level security;

drop policy if exists load_applications_org_all on public.load_applications;
create policy load_applications_org_all on public.load_applications
  for all
  using (org_id in (select org_id from public.profiles where id = auth.uid()))
  with check (org_id in (select org_id from public.profiles where id = auth.uid()));

grant select, insert, update, delete on public.load_applications to authenticated;
grant all on public.load_applications to postgres, service_role;

-- ---------------------------------------------------------------------------
-- Seed formulas (edit/delete later in UI)
-- Variable keys used in expressions: total_w, total_kw, backup_hours, …
-- ---------------------------------------------------------------------------

insert into public.sizing_formulas (
  org_id, name, category, description, expression, result_label, result_unit, variables, notes, sort_order
)
select v.org_id, v.name, v.category, v.description, v.expression, v.result_label, v.result_unit,
       v.variables::jsonb, v.notes, v.sort_order
from (
  values
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Battery bank (Ah)',
    'battery',
    'Lead-acid / tubular style Ah from continuous load and backup hours.',
    '(total_w * backup_hours) / (system_voltage * dod * efficiency)',
    'Battery capacity',
    'Ah',
    '[{"key":"total_w","label":"Total load","unit":"W","default_value":1000},{"key":"backup_hours","label":"Backup time","unit":"h","default_value":4},{"key":"system_voltage","label":"DC bus voltage","unit":"V","default_value":48},{"key":"dod","label":"Depth of discharge","unit":"0–1","default_value":0.5},{"key":"efficiency","label":"Inverter efficiency","unit":"0–1","default_value":0.9}]',
    'total_w is auto-filled from selected loads when using the calculator.',
    10
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Battery / BESS energy (kWh)',
    'bess',
    'Usable energy storage from load and autonomy.',
    '(total_w * backup_hours) / (1000 * dod * efficiency)',
    'Energy storage',
    'kWh',
    '[{"key":"total_w","label":"Total load","unit":"W","default_value":1000},{"key":"backup_hours","label":"Backup / autonomy","unit":"h","default_value":4},{"key":"dod","label":"Usable DoD","unit":"0–1","default_value":0.9},{"key":"efficiency","label":"Round-trip / inverter eff.","unit":"0–1","default_value":0.92}]',
    'For Li-ion BESS, DoD is often 0.8–0.95.',
    20
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Inverter / UPS size (kVA)',
    'inverter',
    'Inverter rating from continuous load with surge margin and power factor.',
    '(total_w * surge_factor) / (1000 * power_factor)',
    'Inverter size',
    'kVA',
    '[{"key":"total_w","label":"Total load","unit":"W","default_value":1000},{"key":"surge_factor","label":"Surge / safety factor","unit":"×","default_value":1.25},{"key":"power_factor","label":"Power factor","unit":"0–1","default_value":0.8}]',
    'Use higher surge_factor when motors/ACs start on UPS.',
    30
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Solar array — home (kW)',
    'solar_home',
    'Array size from daily energy need and peak sun hours.',
    'daily_kwh / (peak_sun_hours * system_derate)',
    'Solar array',
    'kW',
    '[{"key":"daily_kwh","label":"Daily energy need","unit":"kWh/day","default_value":10},{"key":"peak_sun_hours","label":"Peak sun hours","unit":"h","default_value":5},{"key":"system_derate","label":"System derate","unit":"0–1","default_value":0.8}]',
    'daily_kwh ≈ total_kw × hours_used_per_day (adjust in notes).',
    40
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Solar array — industry (kW)',
    'solar_industry',
    'Industrial array sizing with stronger derate for dust/heat.',
    'daily_kwh / (peak_sun_hours * system_derate)',
    'Solar array',
    'kW',
    '[{"key":"daily_kwh","label":"Daily energy need","unit":"kWh/day","default_value":50},{"key":"peak_sun_hours","label":"Peak sun hours","unit":"h","default_value":5},{"key":"system_derate","label":"System derate","unit":"0–1","default_value":0.75}]',
    'Add plant operating hours into daily_kwh estimate.',
    50
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Panel count from array kW',
    'solar_home',
    'Number of modules for a target array size.',
    '(array_kw * 1000) / panel_watt',
    'Panels required',
    'pcs',
    '[{"key":"array_kw","label":"Array size","unit":"kW","default_value":5},{"key":"panel_watt","label":"Module rating","unit":"W","default_value":540}]',
    'Round up in sales quotes.',
    60
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Hybrid PV + battery (kWh bank)',
    'hybrid',
    'Hybrid storage from load and night/autonomy hours.',
    '(total_w * backup_hours) / (1000 * dod * efficiency)',
    'Hybrid battery bank',
    'kWh',
    '[{"key":"total_w","label":"Night / backup load","unit":"W","default_value":1500},{"key":"backup_hours","label":"Autonomy","unit":"h","default_value":6},{"key":"dod","label":"Usable DoD","unit":"0–1","default_value":0.9},{"key":"efficiency","label":"System efficiency","unit":"0–1","default_value":0.9}]',
    'Pair with solar array formula for day generation.',
    70
  ),
  (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'Daily energy from load (kWh)',
    'hybrid',
    'Quick daily kWh from average load and run hours.',
    '(total_w * run_hours) / 1000',
    'Daily energy',
    'kWh/day',
    '[{"key":"total_w","label":"Average load","unit":"W","default_value":1000},{"key":"run_hours","label":"Hours used / day","unit":"h","default_value":8}]',
    'Feed this into solar array formulas as daily_kwh.',
    80
  )
) as v(org_id, name, category, description, expression, result_label, result_unit, variables, notes, sort_order)
where not exists (
  select 1 from public.sizing_formulas f
  where f.org_id = 'a0000000-0000-4000-8000-000000000001'
  limit 1
);

-- ---------------------------------------------------------------------------
-- Seed load applications
-- ---------------------------------------------------------------------------

insert into public.load_applications (
  org_id, name, watts, surge_watts, category, default_qty, notes, sort_order
)
select v.org_id, v.name, v.watts, v.surge_watts, v.category, v.default_qty, v.notes, v.sort_order
from (
  values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'LED bulb', 9, null, 'home', 6, null, 10),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Tube light / LED batten', 20, null, 'home', 4, null, 20),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Ceiling fan', 75, 100, 'home', 3, null, 30),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'TV (LED 32–43")', 80, null, 'home', 1, null, 40),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Laptop / PC', 100, null, 'home', 1, null, 50),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Wi‑Fi router', 15, null, 'home', 1, null, 60),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Refrigerator (single door)', 150, 450, 'home', 1, 'Compressor surge ~3×', 70),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Refrigerator (double door)', 250, 750, 'home', 1, null, 80),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Washing machine', 500, 1200, 'home', 1, null, 90),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Mixer / grinder', 500, 900, 'home', 1, null, 100),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Water pump (0.5 HP)', 375, 1125, 'home', 1, null, 110),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'AC 1 ton (inverter)', 900, 1400, 'home', 1, 'Approx.; check nameplate', 120),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'AC 1.5 ton (inverter)', 1400, 2100, 'home', 1, null, 130),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Geyser / water heater', 2000, null, 'home', 1, 'Resistive; often excluded from UPS', 140),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Microwave', 1200, null, 'home', 1, null, 150),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Office LED lighting (per fixture)', 36, null, 'industry', 20, null, 200),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Desktop PC + monitor', 200, null, 'industry', 5, null, 210),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Server / NAS', 400, null, 'industry', 1, null, 220),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'CNC / small machine tool', 3000, 9000, 'industry', 1, 'Confirm motor nameplate', 230),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Industrial motor 1 HP', 750, 2250, 'industry', 1, null, 240),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Industrial motor 3 HP', 2200, 6600, 'industry', 1, null, 250),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Welding machine (small)', 5000, 8000, 'industry', 1, null, 260),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Cold room compressor (small)', 2500, 7500, 'industry', 1, 'Typical; verify site', 270),
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Petrol pump dispenser + lights (approx.)', 1500, 3000, 'industry', 1, 'Site-specific', 280)
) as v(org_id, name, watts, surge_watts, category, default_qty, notes, sort_order)
where not exists (
  select 1 from public.load_applications l
  where l.org_id = 'a0000000-0000-4000-8000-000000000001'
  limit 1
);
