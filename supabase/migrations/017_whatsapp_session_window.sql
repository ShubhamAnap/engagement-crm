-- WhatsApp Meta 24-hour customer care window
-- Stores last inbound customer message time; free-form replies allowed for 24h after.

alter table public.conversations
  add column if not exists wa_last_customer_at timestamptz;

create index if not exists conversations_wa_window_idx
  on public.conversations (org_id, channel, wa_last_customer_at desc)
  where channel = 'whatsapp';

comment on column public.conversations.wa_last_customer_at is
  'Last WhatsApp inbound from customer; free-form agent/AI replies allowed for 24h after this timestamp (Meta policy).';
