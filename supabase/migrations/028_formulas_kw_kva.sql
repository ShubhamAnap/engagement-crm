-- Prefer kW / kVA load helpers (1 kW = 1.2 kVA). Update seeded inverter formula.

update public.sizing_formulas
set
  expression = 'total_kva * surge_factor',
  description = 'Inverter rating from load kVA (1 kW = 1.2 kVA) with surge margin.',
  result_label = 'Inverter size',
  result_unit = 'kVA',
  variables = '[
    {"key":"total_kva","label":"Total load","unit":"kVA","default_value":1.2},
    {"key":"surge_factor","label":"Surge / safety factor","unit":"×","default_value":1.25}
  ]'::jsonb,
  notes = 'total_kva is auto-filled from selected loads (1000 W = 1 kW, 1 kW = 1.2 kVA).',
  updated_at = now()
where org_id = 'a0000000-0000-4000-8000-000000000001'
  and name = 'Inverter / UPS size (kVA)'
  and (
    expression = '(total_w * surge_factor) / (1000 * power_factor)'
    or expression not ilike '%total_kva%'
  );
