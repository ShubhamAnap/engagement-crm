-- Sales person directory: email → display name + mobile (for WhatsApp template merge)
create table if not exists public.sales_person_directory (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  display_name text not null,
  mobile text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, email)
);

create index if not exists sales_person_directory_org_idx
  on public.sales_person_directory (org_id, is_active);

create trigger sales_person_directory_updated_at
  before update on public.sales_person_directory
  for each row execute function public.handle_updated_at();

alter table public.sales_person_directory enable row level security;

drop policy if exists sales_person_directory_org on public.sales_person_directory;
create policy sales_person_directory_org on public.sales_person_directory
  for all using (
    org_id in (select org_id from public.profiles where id = auth.uid())
  )
  with check (
    org_id in (select org_id from public.profiles where id = auth.uid())
  );

grant select, insert, update, delete on public.sales_person_directory to authenticated;
grant all on public.sales_person_directory to service_role;
