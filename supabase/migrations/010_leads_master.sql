-- Upgrade leads into master CRM table
-- Adds: requirement, notes, tags, location, sales_person
-- Run in Supabase SQL Editor after prior migrations.

alter table public.leads
  add column if not exists requirement text,
  add column if not exists notes text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists location text,
  add column if not exists sales_person text;

-- Backfill from existing fields / metadata
update public.leads
set requirement = coalesce(nullif(requirement, ''), product_label)
where requirement is null and product_label is not null;

update public.leads
set notes = coalesce(
  nullif(notes, ''),
  nullif(metadata->>'notes', '')
)
where notes is null
  and metadata ? 'notes';

comment on column public.leads.requirement is 'What the customer asked for (UPS, battery, service, etc.)';
comment on column public.leads.sales_person is 'Assigned salesperson display name';
comment on column public.leads.notes is 'Free-text qualification / follow-up notes';
comment on column public.leads.tags is 'Labels for filter and automation';
comment on column public.leads.location is 'City / site location';

create index if not exists leads_tags_gin_idx on public.leads using gin (tags);
create index if not exists leads_sales_person_idx on public.leads (org_id, sales_person);
