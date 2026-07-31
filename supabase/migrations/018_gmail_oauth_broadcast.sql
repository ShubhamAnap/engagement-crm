-- Gmail OAuth + email broadcasting support
-- Tokens live on channels.config for type=email (service role).
-- Broadcast recipients can target email addresses (phone optional).

alter table public.broadcast_recipients
  alter column phone drop not null;

alter table public.broadcast_recipients
  add column if not exists email text;

alter table public.broadcasts
  add column if not exists subject text,
  add column if not exists body_text text,
  add column if not exists body_format text default 'text';

create index if not exists broadcast_recipients_email_idx
  on public.broadcast_recipients (broadcast_id, email)
  where email is not null;

comment on column public.broadcast_recipients.email is
  'Recipient email for channel_type=email broadcasts';
comment on column public.broadcasts.body_format is
  'text | html for email campaigns';
