# Worldwide expansion — Engage CRM (Phase 2)

Enable only after **stable India MRR** and support load is under control (see
`docs/india-gtm-playbook.md`).

## Prerequisites

1. Migration `047_stripe_billing.sql` applied  
2. Stripe account + Prices for Starter / Pro (USD recurring)  
3. Env on Render:

```
STRIPE_SECRET_KEY=sk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_STARTER=price_…
STRIPE_PRICE_PRO=price_…
```

4. Stripe webhook endpoint: `{VITE_APP_URL}/api/webhooks/stripe`  
   Events: `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`

5. Legal: `/dpa`, `/privacy` (GDPR section), `/support` (English SLA) reviewed  

6. Document Supabase **region** for customers who ask about data residency  

## Product already supports multi-country orgs

- Self-serve `/signup` creates an isolated organization  
- Settings → Billing shows **Upgrade (USD)** when Stripe env is set  
- INR Razorpay remains for India  

## GTM outside India

1. English landing (`/features`, `/pricing`) — already bilingual-friendly  
2. Start with **English-speaking SMBs** that bring their own WhatsApp Cloud API / Meta WABA  
3. Compete on price + WhatsApp simplicity, not feature parity with Intercom  
4. Support: async English SLA on `/support`  

## Tax / entity

Involve an accountant before invoicing foreign cards at scale (GST, foreign remittance,
entity). Product code does not replace compliance advice.

## Exit criteria to call Phase 2 “live”

- [ ] One non-India test org pays via Stripe and lands on Starter/Pro  
- [ ] Webhook signature verified in production  
- [ ] Invoice appears under Settings → Billing  
- [ ] Support replied within global SLA once  
