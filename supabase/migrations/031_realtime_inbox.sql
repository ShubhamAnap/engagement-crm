-- Enable Supabase Realtime for Inbox + Human Support live updates.
-- Safe to re-run: skips tables already in the publication.
-- Dashboard → Database → Publications (or run in SQL Editor).

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    execute 'alter publication supabase_realtime add table public.conversations';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end $$;

comment on table public.conversations is
  'Includes Realtime publication for Inbox list + Human Support queue.';
comment on table public.messages is
  'Includes Realtime publication for Inbox thread live updates.';
