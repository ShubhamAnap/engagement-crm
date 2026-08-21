# Business model — Engage CRM (public SaaS)

**Decision (locked):** Engage is sold as a **multi-tenant subscription SaaS**, not as a
one-time codebase / IP dump.

| Do | Do not |
|----|--------|
| Onboard organizations via `/signup` | Publish or sell the private git repo as the product |
| Charge monthly/annual plans (Razorpay INR; Stripe USD when ready) | Transfer exclusive ownership of the source for a one-shot fee as the primary exit |
| Keep the repository private | Compete against your own exclusive buyer after an IP sale |

Codebase sale remains a **backup exit** only (see prior valuation notes). Primary path is
recurring revenue across India, then selected countries.

Public surfaces (no login required):

- `/features` — product landing
- `/pricing` — plan catalogue
- `/support` — SLA
- `/terms`, `/privacy`, `/dpa` — legal
- `/status` — health
- `/login`, `/signup` — access

Operator console: `/platform` (platform admins only).
