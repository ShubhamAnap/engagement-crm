-- Phase: billing operations — per-workspace feature flags, trials and negotiated
-- contracts, a grace period before hard cap enforcement, and invoice detail on
-- billing events.
--
-- Design notes that the column names do not convey:
--
-- * feature_flags: absent key or true = ON. Only an explicit `false` disables, so
--   every existing workspace keeps working after this migration.
-- * custom_limits: per-workspace override of PLAN_CATALOG caps for negotiated deals.
--   Absent key = use the plan default; JSON null = unlimited.
-- * usage_grace_*: when a workspace first breaches a cap it gets a grace window
--   instead of an immediate block. usage_grace_month scopes the window to one
--   billing month so grace becomes available again when counters reset.

alter table public.organizations
  add column if not exists feature_flags jsonb not null default '{}'::jsonb,
  add column if not exists custom_limits jsonb,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists contract_reference text,
  add column if not exists contract_ends_at timestamptz,
  add column if not exists usage_grace_until timestamptz,
  add column if not exists usage_grace_month text,
  add column if not exists past_due_since timestamptz;

comment on column public.organizations.feature_flags is
  'Per-workspace module switches. Absent key or true = enabled; only explicit false disables.';
comment on column public.organizations.custom_limits is
  'Negotiated cap overrides: {monthlyAiSpendCapInr, monthlyWhatsAppCap, maxSeats}. Absent = plan default, null = unlimited.';
comment on column public.organizations.trial_ends_at is
  'Paid-plan trial expiry. While in the future the workspace gets its plan_tier limits without a subscription.';
comment on column public.organizations.contract_reference is
  'Enterprise contract / PO reference shown to platform admins only.';
comment on column public.organizations.usage_grace_until is
  'Cap overage allowed until this time. Set on first breach of the month.';
comment on column public.organizations.usage_grace_month is
  'IST month (YYYY-MM) that usage_grace_until belongs to, so grace resets with the counters.';
comment on column public.organizations.past_due_since is
  'First time billing went past due. Enforcement waits out a grace window from here.';

-- Invoice detail so payment history does not need to re-parse raw webhook payloads.
alter table public.billing_events
  add column if not exists amount numeric(14, 2),
  add column if not exists currency text,
  add column if not exists invoice_id text,
  add column if not exists status text;

comment on column public.billing_events.amount is 'Charged amount in major units (payload sends paise).';

create index if not exists billing_events_invoice_idx
  on public.billing_events (org_id, invoice_id)
  where invoice_id is not null;

-- Trials expire on their own; without this a lapsed trial keeps its paid limits.
create or replace view public.organization_billing_state as
select
  o.id as org_id,
  o.name,
  o.plan_tier,
  o.billing_status,
  o.trial_ends_at,
  (o.trial_ends_at is not null and o.trial_ends_at > now()) as trial_active,
  o.contract_reference,
  o.contract_ends_at,
  o.past_due_since,
  o.usage_grace_until,
  o.usage_grace_month,
  o.feature_flags,
  o.custom_limits
from public.organizations o;

comment on view public.organization_billing_state is
  'Platform ops: billing posture per workspace (service role only)';

revoke all on public.organization_billing_state from public, authenticated, anon;
grant select on public.organization_billing_state to postgres, service_role;
