-- Phase: inbound channel identity must be unique across workspaces.
--
-- Webhooks resolve the workspace purely from these config values (WhatsApp phone number,
-- Meta page / Instagram account, widget key, inbound email secret, IndiaMART push secret).
-- Two workspaces holding the same value means one tenant silently receives the other's
-- messages and leads. Server handlers already refuse duplicates, but the Website channel
-- config is also writable from the browser under RLS, so the guarantee belongs in the DB.
--
-- Each index is created inside its own block: if production already contains a duplicate,
-- the migration must report it instead of failing the whole deploy.

do $$
declare
  stmt text;
  stmts text[] := array[
    $i$create unique index if not exists channels_whatsapp_phone_unique
        on public.channels (type, (config ->> 'phone_number_id'))
        where type = 'whatsapp' and nullif(config ->> 'phone_number_id', '') is not null$i$,

    $i$create unique index if not exists channels_meta_page_unique
        on public.channels (type, (config ->> 'page_id'))
        where type in ('facebook', 'instagram') and nullif(config ->> 'page_id', '') is not null$i$,

    $i$create unique index if not exists channels_meta_ig_account_unique
        on public.channels (type, (config ->> 'ig_account_id'))
        where type in ('facebook', 'instagram') and nullif(config ->> 'ig_account_id', '') is not null$i$,

    $i$create unique index if not exists channels_website_widget_key_unique
        on public.channels ((config ->> 'widget_public_key'))
        where type = 'website' and nullif(config ->> 'widget_public_key', '') is not null$i$,

    $i$create unique index if not exists channels_email_inbound_secret_unique
        on public.channels ((config ->> 'inbound_secret'))
        where type = 'email' and nullif(config ->> 'inbound_secret', '') is not null$i$,

    $i$create unique index if not exists channels_indiamart_push_secret_unique
        on public.channels ((config ->> 'push_secret'))
        where type = 'indiamart' and nullif(config ->> 'push_secret', '') is not null$i$
  ];
begin
  foreach stmt in array stmts loop
    begin
      execute stmt;
    exception when others then
      raise warning 'channel identity index skipped (resolve duplicates, then re-run 044): % / %', sqlerrm, stmt;
    end;
  end loop;
end $$;

-- Report any workspaces that still share an inbound identifier.
create or replace view public.channel_identity_conflicts as
with ids as (
  select c.id, c.org_id, c.type, k.key, nullif(c.config ->> k.key, '') as value
  from public.channels c
  cross join (
    values ('phone_number_id'), ('page_id'), ('ig_account_id'),
           ('widget_public_key'), ('inbound_secret'), ('push_secret')
  ) as k(key)
)
select type, key, value, count(distinct org_id) as workspaces, array_agg(distinct org_id) as org_ids
from ids
where value is not null
group by type, key, value
having count(distinct org_id) > 1;

comment on view public.channel_identity_conflicts is
  'Platform ops: inbound identifiers shared by more than one workspace (should always be empty)';

revoke all on public.channel_identity_conflicts from public, authenticated, anon;
grant select on public.channel_identity_conflicts to postgres, service_role;
