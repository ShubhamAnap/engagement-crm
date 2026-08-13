-- One catalogue PDF per product category (inherited by all SKUs in that category).
-- Product-level catalog_pdf_* still overrides when set.

create table if not exists public.product_category_catalogues (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  category_key text not null,
  category_label text not null,
  catalog_pdf_path text,
  catalog_pdf_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, category_key)
);

create index if not exists product_category_catalogues_org_idx
  on public.product_category_catalogues (org_id);

drop trigger if exists product_category_catalogues_updated_at on public.product_category_catalogues;
create trigger product_category_catalogues_updated_at
  before update on public.product_category_catalogues
  for each row execute function public.handle_updated_at();

alter table public.product_category_catalogues enable row level security;

drop policy if exists product_category_catalogues_org_all on public.product_category_catalogues;
create policy product_category_catalogues_org_all on public.product_category_catalogues
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

grant all on table public.product_category_catalogues to postgres, service_role;
grant select, insert, update, delete on table public.product_category_catalogues to authenticated;

comment on table public.product_category_catalogues is
  'Shared catalogue PDF per product category. Products inherit unless they have their own catalog_pdf.';
