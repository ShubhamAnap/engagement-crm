-- Team members: section permissions + active flag
alter table public.profiles
  add column if not exists permissions jsonb not null default '["dashboard","inbox"]'::jsonb;

alter table public.profiles
  add column if not exists is_active boolean not null default true;

comment on column public.profiles.permissions is
  'Allowed app section keys (sidebar routes). Admins ignore this and get full access.';

comment on column public.profiles.is_active is
  'When false, user cannot use the app (Admin disabled the account).';

-- Existing Admins: full section set (app also grants Admin all access in code)
update public.profiles
set permissions = '[
  "dashboard","command-center","inbox","ai-chat","human-support",
  "agents","tools","formulas","knowledge","automation","broadcasting",
  "products","customers","leads","pipeline",
  "analytics","reports","channels","settings"
]'::jsonb
where role = 'Admin';

-- Non-admins without an explicit list keep Dashboard + Inbox default
update public.profiles
set permissions = '["dashboard","inbox"]'::jsonb
where role <> 'Admin'
  and (
    permissions is null
    or permissions = '[]'::jsonb
    or permissions = 'null'::jsonb
  );
