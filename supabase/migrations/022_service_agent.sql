-- Service Agent (after-sales specialist)
-- Routed when customers report faults / need service (see pickSpecialistKey in src/server/agents.ts).
-- Customize system_prompt in Agents → Configure (UI).

insert into public.agents (org_id, key, name, description, status, model, memory_enabled, system_prompt, config)
values (
  'a0000000-0000-4000-8000-000000000001',
  'service',
  'Service Agent',
  'After-sales support: faults, repairs, AMC, technician visits, service tickets',
  'Active',
  'gpt-4o-mini',
  true,
  null,
  '{}'::jsonb
)
on conflict (org_id, key) do update set
  name = excluded.name,
  description = excluded.description,
  status = coalesce(public.agents.status, excluded.status),
  updated_at = now();
