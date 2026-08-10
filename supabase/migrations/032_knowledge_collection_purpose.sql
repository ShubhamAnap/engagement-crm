-- Collection purpose helps ops + catalogue routing (datasheets vs site photos vs policies).
alter table public.knowledge_collections
  add column if not exists purpose text;

comment on column public.knowledge_collections.purpose is
  'Optional: datasheets | site_photos | policies | faqs | other';

-- Best-effort backfill from existing names
update public.knowledge_collections
set purpose = 'datasheets'
where purpose is null
  and name ~* 'datasheet|catalogue|catalog|brochure|spec';

update public.knowledge_collections
set purpose = 'site_photos'
where purpose is null
  and name ~* 'cold|petrol|hospital|fire|poultry|farm|photo|install|site|gallery';

update public.knowledge_collections
set purpose = 'faqs'
where purpose is null
  and name ~* 'faq';

update public.knowledge_collections
set purpose = 'policies'
where purpose is null
  and name ~* 'polic';
