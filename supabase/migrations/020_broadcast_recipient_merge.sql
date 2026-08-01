-- Per-recipient merge fields for campaign-only CSV email audiences
alter table public.broadcast_recipients
  add column if not exists merge_fields jsonb;

comment on column public.broadcast_recipients.merge_fields is
  'Optional EmailMergeFields from uploaded campaign CSV (not saved as leads)';
