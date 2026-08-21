-- Phase 2 global billing: Stripe customer/subscription ids alongside Razorpay.
alter table public.organizations
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

comment on column public.organizations.stripe_customer_id is 'Stripe Customer id (cus_…) when billed in USD';
comment on column public.organizations.stripe_subscription_id is 'Stripe Subscription id (sub_…) when billed in USD';
