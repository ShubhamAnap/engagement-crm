-- EnerTech Engage — Knowledge Base RAG (pgvector)
-- Run in Supabase SQL Editor after 003_core_schema.sql
-- Enables vector search for EnerBot grounded answers + catalogue PDF metadata.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Products: optional catalogue / datasheet PDF
-- ---------------------------------------------------------------------------

alter table public.products
  add column if not exists catalog_pdf_path text,
  add column if not exists catalog_pdf_url text;

-- ---------------------------------------------------------------------------
-- Knowledge chunks (embedded text)
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null references public.knowledge_documents (id) on delete cascade,
  collection_id uuid not null references public.knowledge_collections (id) on delete cascade,
  chunk_index integer not null default 0,
  content text not null,
  token_estimate integer not null default 0,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_org_id_idx on public.knowledge_chunks (org_id);
create index if not exists knowledge_chunks_document_idx on public.knowledge_chunks (document_id);
create index if not exists knowledge_chunks_collection_idx on public.knowledge_chunks (collection_id);

-- IVFFlat needs rows first; use HNSW for better default experience on modest corpora.
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

alter table public.knowledge_chunks enable row level security;

drop policy if exists knowledge_chunks_org_all on public.knowledge_chunks;
create policy knowledge_chunks_org_all on public.knowledge_chunks
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

grant all on table public.knowledge_chunks to postgres, service_role;
grant select, insert, update, delete on table public.knowledge_chunks to authenticated;

-- ---------------------------------------------------------------------------
-- Similarity search RPC (service role + authenticated)
-- ---------------------------------------------------------------------------

create or replace function public.match_knowledge_chunks(
  query_embedding vector(1536),
  match_org_id uuid,
  match_count integer default 6,
  match_threshold float default 0.65
)
returns table (
  id uuid,
  document_id uuid,
  collection_id uuid,
  content text,
  similarity float,
  metadata jsonb,
  document_title text,
  source_url text,
  storage_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.document_id,
    c.collection_id,
    c.content,
    (1 - (c.embedding <=> query_embedding))::float as similarity,
    c.metadata,
    d.title as document_title,
    d.source_url,
    d.storage_path
  from public.knowledge_chunks c
  join public.knowledge_documents d on d.id = c.document_id
  where c.org_id = match_org_id
    and c.embedding is not null
    and (1 - (c.embedding <=> query_embedding)) >= match_threshold
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_knowledge_chunks(vector, uuid, integer, float) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage bucket for knowledge / catalogue PDFs
-- Create via SQL if storage schema is available (Supabase).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('knowledge', 'knowledge', true)
on conflict (id) do update set public = excluded.public;

-- Public read for catalogue downloads; authenticated write for org staff.
drop policy if exists knowledge_storage_public_read on storage.objects;
create policy knowledge_storage_public_read
  on storage.objects for select
  using (bucket_id = 'knowledge');

drop policy if exists knowledge_storage_auth_write on storage.objects;
create policy knowledge_storage_auth_write
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'knowledge');

drop policy if exists knowledge_storage_auth_update on storage.objects;
create policy knowledge_storage_auth_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'knowledge')
  with check (bucket_id = 'knowledge');

drop policy if exists knowledge_storage_auth_delete on storage.objects;
create policy knowledge_storage_auth_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'knowledge');
