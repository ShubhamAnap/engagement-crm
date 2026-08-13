-- MRP (WordPress regular price) alongside selling/sale price on products.
-- price_paise / price_label stay the selling price.

alter table public.products
  add column if not exists mrp_paise bigint,
  add column if not exists mrp_label text;

comment on column public.products.mrp_paise is
  'List/MRP in paise (Woo regular_price). Selling price remains price_paise.';
comment on column public.products.mrp_label is
  'Display MRP e.g. ₹52,900. Chat shows Price: ₹sale (MRP ₹regular) when different.';
