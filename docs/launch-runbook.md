# Launch Runbook

Phase 6 covers the final operational checks before selling or broadly launching shared multi-org Engage CRM.

## 1. Required migrations

Run these in Supabase SQL Editor, in order:

1. `039_storage_org_isolation.sql`
2. `040_auth_completeness.sql`
3. `041_billing.sql`
4. `042_platform_admin.sql`
5. `043_platform_impersonation.sql`
6. `044_channel_identity_uniqueness.sql`
7. `045_billing_ops.sql`

After `044`, confirm no workspace shares an inbound identifier:

```sql
select * from public.channel_identity_conflicts;
```

The result must be empty. Any row means two workspaces share a WhatsApp number, Meta
page, widget key, or inbound secret — fix the duplicate, then re-run `044` so the unique
indexes are created.

## 2. Required environment and external setup

- Supabase auth redirect URLs:
  - `{APP_URL}/auth/callback`
  - `{APP_URL}/accept-invite`
- Platform admin access:
  - `PLATFORM_ADMIN_EMAILS=you@company.com` or row in `platform_admins`
- Billing (optional, but all-or-nothing — if you set `RAZORPAY_KEY_ID` you must set the
  webhook secret):
  - `RAZORPAY_KEY_ID`
  - `RAZORPAY_KEY_SECRET`
  - `RAZORPAY_WEBHOOK_SECRET` — required. Razorpay events name their target workspace in
    `notes.org_id`, so without signature verification anyone could POST
    `subscription.activated` and upgrade any workspace. Production returns 403 when unset.
  - `RAZORPAY_PLAN_STARTER`
  - `RAZORPAY_PLAN_PRO`
- Meta webhooks (WhatsApp / Facebook / Instagram):
  - `META_APP_SECRET` — the Meta **App Secret**, not an access token. Production rejects
    unsigned or mismatched webhooks without it, because every workspace is subscribed to
    one Meta App and an unverified event can name any workspace's page.
  - `META_WEBHOOK_ALLOW_UNSIGNED` — leave empty. Only set during first-time setup, and
    unset it immediately afterwards.
- `VITE_APP_URL` — must be the public HTTPS origin. Customer-facing `/c` and `/f` short
  links are built from it and carry a `?w=` workspace token; a wrong origin produces dead
  links for every tenant.

## 3. Two-org isolation checklist

Create two workspaces, `Org A` and `Org B`, with separate admins.

### Data isolation

- `Org A` cannot open `Org B` leads, customers, products, conversations, knowledge docs, or reports.
- Product upload in `Org A` does not appear in `Org B`.
- Audit log in `Org A` does not show `Org B` actions.
- Platform `/platform` can see both; normal org admins can only see their own org.

### Storage isolation

- Upload avatar/logo/product PDF in `Org A`; confirm stored paths begin with `org_a_uuid/`.
- Repeat in `Org B`; confirm stored paths begin with `org_b_uuid/`.
- Confirm authenticated bucket listing does not expose the other org's prefix.

### Channel/webhook isolation

- WhatsApp inbound for `Org A` lands in `Org A` inbox only.
- Email or Meta webhook for `Org B` lands in `Org B` only.
- Website widget public key from `Org A` cannot post into `Org B`.
- Saving `Org A`'s WhatsApp number, Meta page, inbound email secret, or IndiaMART push
  secret in `Org B` is rejected with a "already connected to another workspace" message.
- A Meta webhook POST without a valid `X-Hub-Signature-256` returns 403 in production.
- A Razorpay POST without a valid `x-razorpay-signature` returns 401, and one sent while
  `RAZORPAY_WEBHOOK_SECRET` is unset returns 403 — neither changes any workspace's plan.

### Signup

- A new signup lands on a workspace whose Channels page already lists Website Chat
  (Connected, with a widget key) plus the disconnected channels, and two default agents.
  Provisioning now rolls back rather than leaving a workspace without them.

### Public short links

- Share the same SKU in both workspaces; `/c/{sku}?w=…` returns each workspace's own
  catalogue, and a `/c/{sku}` link with no token 404s while the SKU is ambiguous.
- Suspending a workspace makes its `/c` and `/f` links stop resolving.

### Billing / limits

- Free-plan org hits AI limit and gets blocked.
- BYOK OpenAI key bypasses platform AI cap.
- Seat limit blocks excess invites.
- WhatsApp cap blocks outbound sends after threshold.

## 4. Backup / restore procedure

### Workspace-level export

- Settings → Team → Danger zone → `Download export`
- Export covers:
  - organization
  - profiles
  - leads
  - customers
  - conversation metadata
  - products
  - channels
  - automations

### Platform-level backup

- Supabase:
  - nightly Postgres backup enabled
  - point-in-time recovery configured if available on plan
- Storage:
  - keep the Supabase Storage bucket backup/export strategy documented
  - verify `knowledge` and `branding` buckets are included
- Render:
  - confirm environment variables are backed up outside Render UI

### Restore drill

At least once before launch:

1. Restore a non-production database snapshot.
2. Verify a deleted lead/customer/conversation can be recovered in staging.
3. Verify storage objects under an org prefix are restorable.

## 5. Delete flows

### User account deletion

- Settings → Security → `Delete my account`
- Block if:
  - user is the last Admin in a multi-member workspace
  - user is the last member in the workspace

### Workspace deletion

- Settings → Team → Danger zone → `Delete workspace permanently`
- Requires:
  - exact workspace name
  - `DELETE WORKSPACE`
- Effect:
  - deletes auth users in workspace
  - deletes org database records via cascade
  - removes known storage prefixes in `knowledge` and `branding`

## 6. Support runbook

### Common support actions

- Suspend abusive tenant: `/platform` → select org → suspend
- Reactivate tenant: `/platform` → reactivate
- Manual plan correction: `/platform` → override plan
- Billing exception/refund note: `/platform` → billing credit
- Export customer data: org admin → Settings → Team → Danger zone

### First-response triage

1. Confirm org id and admin email.
2. Check `/platform` for:
   - org active/suspended
   - plan tier
   - billing status
   - recent audit events
3. Check `/status`.
4. If channel-specific, inspect channel health and last update time.

### Usage limits, grace, and modules

Caps are not cliffs. The first time a workspace crosses its monthly AI or WhatsApp cap it
gets a **3-day grace window** and keeps working; only after that window closes do sends
fail. Grace is scoped to the billing month, so it becomes available again when the counters
reset on the 1st (IST).

A failed payment behaves the same way: `past_due` starts a **7-day** clock from the first
failure, and the workspace keeps its paid limits until the clock runs out. Recovering the
payment clears it, so a later lapse gets a fresh window.

Seats are the exception — an invite over the seat cap is refused immediately, because
admitting a member you would later have to remove is worse than refusing the invite.

Operator actions in `/platform` → select workspace:

- **Modules** tab: switch AI, WhatsApp sending, or marketplace sync off for one workspace.
  Enforcement is server-side, so the customer sees a clear refusal rather than a broken page.
- **Modules** → Trial and contract: set a trial expiry (holds the paid tier without a
  subscription), record a contract/PO reference, and set negotiated caps that override the
  plan. A blank cap means "use the plan default"; `0` means unlimited.
- **Modules** → Grace window: clear an open grace window and the past-due clock, e.g. right
  after a customer upgrades.
- **Risk** tab: workspaces with spend spikes, cap breaches, lapsed payments, expiring trials,
  or disabled modules, worst first. Advisory only — nothing is suspended automatically.
  Exportable as CSV, as is the workspace list.

### Escalation triggers

- Cross-tenant data visibility
- Message routed to wrong org
- Storage object accessible outside expected org prefix
- Failed org deletion leaving orphaned auth users
- Billing charged but plan not activated

## 7. Pre-launch signoff

- [ ] Migrations 039–045 run in production Supabase
- [ ] `channel_identity_conflicts` returns no rows
- [ ] `/platform` → Risk tab loads and shows no unexplained signals
- [ ] Module switches verified: turn AI off for a test workspace, confirm replies are refused
- [ ] `META_APP_SECRET` set and `META_WEBHOOK_ALLOW_UNSIGNED` empty (signed webhooks enforced)
- [ ] Suspended workspace verified blocked: UI, server functions, webhooks, cron
- [ ] Two-org manual isolation pass completed
- [ ] Backup/restore drill completed
- [ ] Delete-account and delete-workspace flows tested in staging
- [ ] Platform admin access tested
- [ ] Terms / Privacy copy reviewed by business/legal owner
- [ ] Support owner has read this runbook
