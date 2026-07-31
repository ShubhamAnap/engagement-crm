-- WhatsApp broadcasting + message templates
-- Run in Supabase SQL Editor after 008.

create type public.wa_template_status as enum (
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'PAUSED',
  'DISABLED'
);

create type public.broadcast_status as enum (
  'Draft',
  'Queued',
  'Sending',
  'Completed',
  'Failed',
  'Cancelled'
);

create table if not exists public.wa_message_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  channel_type text not null default 'whatsapp',
  name text not null,
  language text not null default 'en',
  category text not null default 'MARKETING',
  status public.wa_template_status not null default 'DRAFT',
  body_text text not null default '',
  header_text text,
  footer_text text,
  components jsonb not null default '[]'::jsonb,
  meta_id text,
  rejection_reason text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name, language)
);

create index if not exists wa_message_templates_org_idx
  on public.wa_message_templates (org_id, status);

create trigger wa_message_templates_updated_at
  before update on public.wa_message_templates
  for each row execute function public.handle_updated_at();

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  channel_type text not null default 'whatsapp',
  name text not null,
  status public.broadcast_status not null default 'Draft',
  template_id uuid references public.wa_message_templates (id) on delete set null,
  template_name text,
  template_language text,
  variable_values jsonb not null default '[]'::jsonb,
  audience jsonb not null default '{}'::jsonb,
  total_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists broadcasts_org_idx on public.broadcasts (org_id, created_at desc);

create trigger broadcasts_updated_at
  before update on public.broadcasts
  for each row execute function public.handle_updated_at();

create table if not exists public.broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  broadcast_id uuid not null references public.broadcasts (id) on delete cascade,
  phone text not null,
  name text,
  customer_id uuid references public.customers (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  status text not null default 'pending',
  error text,
  wa_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists broadcast_recipients_broadcast_idx
  on public.broadcast_recipients (broadcast_id, status);

alter table public.wa_message_templates enable row level security;
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;

drop policy if exists wa_templates_org on public.wa_message_templates;
create policy wa_templates_org on public.wa_message_templates
  for all using (
    org_id in (select org_id from public.profiles where id = auth.uid())
  )
  with check (
    org_id in (select org_id from public.profiles where id = auth.uid())
  );

drop policy if exists broadcasts_org on public.broadcasts;
create policy broadcasts_org on public.broadcasts
  for all using (
    org_id in (select org_id from public.profiles where id = auth.uid())
  )
  with check (
    org_id in (select org_id from public.profiles where id = auth.uid())
  );

drop policy if exists broadcast_recipients_org on public.broadcast_recipients;
create policy broadcast_recipients_org on public.broadcast_recipients
  for all using (
    org_id in (select org_id from public.profiles where id = auth.uid())
  )
  with check (
    org_id in (select org_id from public.profiles where id = auth.uid())
  );

grant select, insert, update, delete on public.wa_message_templates to authenticated;
grant select, insert, update, delete on public.broadcasts to authenticated;
grant select, insert, update, delete on public.broadcast_recipients to authenticated;
grant all on public.wa_message_templates to service_role;
grant all on public.broadcasts to service_role;
grant all on public.broadcast_recipients to service_role;
