-- EnerTech Engage — Phase 0.5 core domain schema
-- Run in Supabase SQL Editor after 001 + 002.
-- Creates CRM, chat/inbox, channels, products, knowledge, agents.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid() limit 1
$$;

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and org_id = target_org
  )
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.channel_type as enum (
    'website', 'whatsapp', 'email', 'instagram', 'facebook', 'api', 'webhook'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.conversation_status as enum (
    'ai', 'human', 'escalated', 'resolved', 'closed'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.message_sender as enum (
    'customer', 'ai', 'agent', 'system'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.lead_status as enum (
    'New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.priority_level as enum ('High', 'Medium', 'Low');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.stock_status as enum (
    'In Stock', 'Low Stock', 'Made to Order', 'Out of Stock'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.channel_status as enum (
    'Connected', 'Degraded', 'Disconnected', 'Action Required'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.agent_status as enum (
    'Active', 'Paused', 'Degraded'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.knowledge_status as enum (
    'Indexed', 'Embedding', 'Stale', 'Failed'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.document_status as enum (
    'pending', 'processing', 'ready', 'failed'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  company text,
  email text,
  phone text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_org_id_idx on public.customers (org_id);
create index if not exists customers_email_idx on public.customers (org_id, email);
create index if not exists customers_phone_idx on public.customers (org_id, phone);

create trigger customers_updated_at
  before update on public.customers
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  sku text not null,
  name text not null,
  category text,
  description text,
  stock_status public.stock_status not null default 'In Stock',
  quantity integer not null default 0,
  price_paise bigint, -- store INR as paise to avoid float issues; null = unset
  price_label text,   -- display string e.g. ₹52,900 (optional cache)
  ai_weight numeric(4,3) not null default 0.500,
  battery_spec text,
  runtime_spec text,
  specs jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, sku)
);

create index if not exists products_org_id_idx on public.products (org_id);
create index if not exists products_category_idx on public.products (org_id, category);

create trigger products_updated_at
  before update on public.products
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  external_ref text, -- e.g. LD-2201 display id
  score integer not null default 0 check (score >= 0 and score <= 100),
  status public.lead_status not null default 'New',
  priority public.priority_level not null default 'Medium',
  source public.channel_type,
  name text not null,
  company text,
  phone text,
  email text,
  product_label text,
  owner_id uuid references public.profiles (id) on delete set null,
  value_paise bigint,
  value_label text,
  last_activity_at timestamptz,
  next_follow_up_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_org_id_idx on public.leads (org_id);
create index if not exists leads_status_idx on public.leads (org_id, status);
create index if not exists leads_owner_idx on public.leads (org_id, owner_id);
create index if not exists leads_customer_idx on public.leads (customer_id);

create trigger leads_updated_at
  before update on public.leads
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- Channels
-- ---------------------------------------------------------------------------

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  type public.channel_type not null,
  name text not null,
  status public.channel_status not null default 'Disconnected',
  health integer not null default 100 check (health >= 0 and health <= 100),
  detail text,
  config jsonb not null default '{}'::jsonb, -- credentials stored encrypted later
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, type)
);

create index if not exists channels_org_id_idx on public.channels (org_id);

create trigger channels_updated_at
  before update on public.channels
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- AI Agents (config)
-- ---------------------------------------------------------------------------

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null, -- e.g. sales, support
  name text not null,
  description text,
  status public.agent_status not null default 'Active',
  model text not null default 'gpt-4o-mini',
  memory_enabled boolean not null default true,
  system_prompt text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create index if not exists agents_org_id_idx on public.agents (org_id);

create trigger agents_updated_at
  before update on public.agents
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- Conversations + Messages (Website chat / Inbox)
-- ---------------------------------------------------------------------------

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  channel_id uuid references public.channels (id) on delete set null,
  channel public.channel_type not null default 'website',
  external_ref text, -- e.g. CV-4821
  subject text,
  preview text,
  status public.conversation_status not null default 'ai',
  unread_count integer not null default 0,
  assignee_id uuid references public.profiles (id) on delete set null,
  assignee_label text, -- "AI · Sales Agent" or human name cache
  agent_id uuid references public.agents (id) on delete set null,
  confidence numeric(4,3),
  tags text[] not null default '{}',
  visitor_name text,
  visitor_email text,
  visitor_phone text,
  visitor_company text,
  widget_session_id text, -- browser session for embed widget
  metadata jsonb not null default '{}'::jsonb,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_org_id_idx on public.conversations (org_id);
create index if not exists conversations_status_idx on public.conversations (org_id, status);
create index if not exists conversations_channel_idx on public.conversations (org_id, channel);
create index if not exists conversations_customer_idx on public.conversations (customer_id);
create index if not exists conversations_widget_session_idx on public.conversations (org_id, widget_session_id);
create index if not exists conversations_last_message_idx on public.conversations (org_id, last_message_at desc);

create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function public.handle_updated_at();

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender public.message_sender not null,
  sender_profile_id uuid references public.profiles (id) on delete set null,
  body text not null,
  confidence numeric(4,3),
  sources jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);
create index if not exists messages_org_id_idx on public.messages (org_id);

-- Keep conversation preview / last_message_at in sync
create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set
    preview = left(new.body, 240),
    last_message_at = new.created_at,
    updated_at = now(),
    unread_count = case
      when new.sender = 'customer' then unread_count + 1
      else unread_count
    end
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

-- ---------------------------------------------------------------------------
-- Knowledge
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_collections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text,
  status public.knowledge_status not null default 'Indexed',
  doc_count integer not null default 0,
  chunk_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

create index if not exists knowledge_collections_org_id_idx on public.knowledge_collections (org_id);

create trigger knowledge_collections_updated_at
  before update on public.knowledge_collections
  for each row execute function public.handle_updated_at();

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  collection_id uuid not null references public.knowledge_collections (id) on delete cascade,
  title text not null,
  source_url text,
  storage_path text,
  mime_type text,
  status public.document_status not null default 'pending',
  chunk_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_documents_org_id_idx on public.knowledge_documents (org_id);
create index if not exists knowledge_documents_collection_idx on public.knowledge_documents (collection_id);

create trigger knowledge_documents_updated_at
  before update on public.knowledge_documents
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.leads enable row level security;
alter table public.channels enable row level security;
alter table public.agents enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.knowledge_collections enable row level security;
alter table public.knowledge_documents enable row level security;

-- Org members: full CRUD on org-scoped data (tighten later by role if needed)

create policy customers_org_all on public.customers
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy products_org_all on public.products
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy leads_org_all on public.leads
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy channels_org_all on public.channels
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy agents_org_all on public.agents
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy conversations_org_all on public.conversations
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy messages_org_all on public.messages
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy knowledge_collections_org_all on public.knowledge_collections
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy knowledge_documents_org_all on public.knowledge_documents
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Grants (Automatically expose new tables = OFF)
-- ---------------------------------------------------------------------------

grant all on table public.customers to postgres, service_role;
grant select, insert, update, delete on table public.customers to authenticated;

grant all on table public.products to postgres, service_role;
grant select, insert, update, delete on table public.products to authenticated;

grant all on table public.leads to postgres, service_role;
grant select, insert, update, delete on table public.leads to authenticated;

grant all on table public.channels to postgres, service_role;
grant select, insert, update, delete on table public.channels to authenticated;

grant all on table public.agents to postgres, service_role;
grant select, insert, update, delete on table public.agents to authenticated;

grant all on table public.conversations to postgres, service_role;
grant select, insert, update, delete on table public.conversations to authenticated;

grant all on table public.messages to postgres, service_role;
grant select, insert, update, delete on table public.messages to authenticated;

grant all on table public.knowledge_collections to postgres, service_role;
grant select, insert, update, delete on table public.knowledge_collections to authenticated;

grant all on table public.knowledge_documents to postgres, service_role;
grant select, insert, update, delete on table public.knowledge_documents to authenticated;

grant execute on function public.current_org_id() to authenticated, service_role;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seed defaults for EnerTech org
-- ---------------------------------------------------------------------------

insert into public.channels (org_id, type, name, status, health, detail, is_enabled)
values
  ('a0000000-0000-4000-8000-000000000001', 'website', 'Website Chat', 'Connected', 100, 'embed widget', true),
  ('a0000000-0000-4000-8000-000000000001', 'whatsapp', 'WhatsApp Business', 'Disconnected', 0, null, false),
  ('a0000000-0000-4000-8000-000000000001', 'email', 'Email', 'Disconnected', 0, null, false),
  ('a0000000-0000-4000-8000-000000000001', 'instagram', 'Instagram', 'Disconnected', 0, null, false),
  ('a0000000-0000-4000-8000-000000000001', 'facebook', 'Facebook Messenger', 'Disconnected', 0, null, false)
on conflict (org_id, type) do nothing;

insert into public.agents (org_id, key, name, description, status, model, memory_enabled)
values
  ('a0000000-0000-4000-8000-000000000001', 'sales', 'Sales Agent', 'Product discovery, pricing guidance, lead capture', 'Active', 'gpt-4o-mini', true),
  ('a0000000-0000-4000-8000-000000000001', 'support', 'Support Agent', 'Troubleshooting, ticket triage, SLA replies', 'Active', 'gpt-4o-mini', true),
  ('a0000000-0000-4000-8000-000000000001', 'technical', 'Technical Agent', 'Deep diagnostics from manuals and schematics', 'Active', 'gpt-4o-mini', true),
  ('a0000000-0000-4000-8000-000000000001', 'warranty', 'Warranty Agent', 'Warranty validation, RMA and claim workflow', 'Active', 'gpt-4o-mini', false),
  ('a0000000-0000-4000-8000-000000000001', 'battery', 'Battery Calculator Agent', 'Runtime, sizing and backup calculations', 'Active', 'gpt-4o-mini', false),
  ('a0000000-0000-4000-8000-000000000001', 'quotation', 'Quotation Agent', 'Builds and sends priced quotations', 'Active', 'gpt-4o-mini', true),
  ('a0000000-0000-4000-8000-000000000001', 'followup', 'Follow-up Agent', 'Nurture sequences and reminders', 'Active', 'gpt-4o-mini', true),
  ('a0000000-0000-4000-8000-000000000001', 'email', 'Email Agent', 'Inbound email parsing and drafted replies', 'Paused', 'gpt-4o-mini', true)
on conflict (org_id, key) do nothing;

insert into public.knowledge_collections (org_id, name, description, status)
values
  ('a0000000-0000-4000-8000-000000000001', 'Products', 'Product pages and specs', 'Indexed'),
  ('a0000000-0000-4000-8000-000000000001', 'Manuals', 'Installation and service manuals', 'Indexed'),
  ('a0000000-0000-4000-8000-000000000001', 'FAQs', 'Frequently asked questions', 'Indexed'),
  ('a0000000-0000-4000-8000-000000000001', 'Datasheets', 'Technical datasheets', 'Indexed'),
  ('a0000000-0000-4000-8000-000000000001', 'Warranty', 'Warranty policies', 'Indexed'),
  ('a0000000-0000-4000-8000-000000000001', 'Installation', 'Installation guides', 'Indexed'),
  ('a0000000-0000-4000-8000-000000000001', 'Policies', 'Company policies', 'Stale'),
  ('a0000000-0000-4000-8000-000000000001', 'Pricing', 'Pricing sheets', 'Indexed')
on conflict (org_id, name) do nothing;
