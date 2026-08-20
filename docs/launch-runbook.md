# Launch Runbook

Phase 6 covers the final operational checks before selling or broadly launching shared multi-org Engage CRM.

## 1. Required migrations

Run these in Supabase SQL Editor, in order:

1. `039_storage_org_isolation.sql`
2. `040_auth_completeness.sql`
3. `041_billing.sql`
4. `042_platform_admin.sql`

## 2. Required environment and external setup

- Supabase auth redirect URLs:
  - `{APP_URL}/auth/callback`
  - `{APP_URL}/accept-invite`
- Platform admin access:
  - `PLATFORM_ADMIN_EMAILS=you@company.com` or row in `platform_admins`
- Optional billing:
  - `RAZORPAY_KEY_ID`
  - `RAZORPAY_KEY_SECRET`
  - `RAZORPAY_WEBHOOK_SECRET`
  - `RAZORPAY_PLAN_STARTER`
  - `RAZORPAY_PLAN_PRO`

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

### Escalation triggers

- Cross-tenant data visibility
- Message routed to wrong org
- Storage object accessible outside expected org prefix
- Failed org deletion leaving orphaned auth users
- Billing charged but plan not activated

## 7. Pre-launch signoff

- [ ] Migrations 039–042 run in production Supabase
- [ ] Two-org manual isolation pass completed
- [ ] Backup/restore drill completed
- [ ] Delete-account and delete-workspace flows tested in staging
- [ ] Platform admin access tested
- [ ] Terms / Privacy copy reviewed by business/legal owner
- [ ] Support owner has read this runbook
