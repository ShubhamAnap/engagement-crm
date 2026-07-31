-- Product image for WhatsApp recommendation cards (Path B)
alter table public.products
  add column if not exists image_path text,
  add column if not exists image_url text;

comment on column public.products.image_url is
  'Public HTTPS URL used for WhatsApp product recommendation image messages';
