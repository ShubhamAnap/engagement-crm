-- Brainmine / external CRM attribution fields for campaign targeting
-- crm_source = original source inside the CRM (IndiaMART, Website, …)
-- crm_created_at / crm_modified_at = timestamps from the CRM record

alter table public.leads
  add column if not exists crm_source text,
  add column if not exists crm_created_at timestamptz,
  add column if not exists crm_modified_at timestamptz;

comment on column public.leads.crm_source is 'Original lead source inside external CRM (e.g. Brainmine source)';
comment on column public.leads.crm_created_at is 'When the lead was created in the external CRM';
comment on column public.leads.crm_modified_at is 'When the lead was last modified in the external CRM';

create index if not exists leads_crm_source_idx on public.leads (org_id, crm_source);
create index if not exists leads_crm_created_idx on public.leads (org_id, crm_created_at desc);
