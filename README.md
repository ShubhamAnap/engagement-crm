# EnerTech Engage

Enterprise AI customer engagement platform for **EnerTech UPS Pvt. Ltd.**

Omnichannel support and sales — Website Chat, WhatsApp, Email, Instagram, Facebook — with AI agents, CRM, knowledge base, and analytics.

## Stack

- TanStack Start (SSR) + TanStack Router + TanStack Query
- React 19, TypeScript, Vite 8
- Tailwind CSS 4 + shadcn/ui
- Supabase (Postgres + Auth) — Phase 0
- OpenAI (GPT-4o-mini) — AI layer
- Deploy: GitHub → Render (Web Service)

## Development

Requires Node.js 20+.

```sh
npm install
npm run dev
```

App runs at **http://localhost:8080/**

```sh
npm run build
npm start
```

## Deploy on Render

Repo: `https://github.com/ShubhamAnap/enertechsupport`  
Blueprint: [`render.yaml`](./render.yaml) (Web Service + 5‑min automations cron).

1. Open [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint** (or **Web Service**).
2. Connect GitHub repo **ShubhamAnap/enertechsupport**, branch `main`.
3. If using Web Service manually:
   - **Runtime:** **Node** (not Bun — `bun.lock` can auto-select Bun and skip Vite)
   - **Build:** `bash scripts/render-build.sh` (Vite 7; clears `node_modules`, installs, builds)
   - **Start:** `npm run start:check` (or `npm start`)
   - **Node:** 22 (`NODE_VERSION=22.14.0` or `.node-version`) — required for Supabase WebSocket / Realtime
   - Build logs must show `vite build` / Nitro `.output` — not only package install
4. Set environment variables (copy from local `.env` — never commit it):

| Key | Notes |
|-----|--------|
| `VITE_APP_URL` | `https://<your-service>.onrender.com` (set after first URL is known; redeploy) |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Required at **build** time |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Server |
| `WIDGET_PUBLIC_KEY` / `VITE_WIDGET_PUBLIC_KEY` | Same value |
| `OPENAI_API_KEY` | AI chat / RAG |
| `CRON_SECRET` | Protects `/api/cron/automations` |
| WhatsApp / email / Meta | Optional; or configure later in **Channels** |

5. After deploy: set `VITE_APP_URL` to the Render HTTPS URL → **Manual Deploy**.
6. Cron job: set `CRON_URL` = `https://<service>.onrender.com/api/cron/automations` and the same `CRON_SECRET`.
7. WhatsApp webhook in Meta: `https://<service>.onrender.com/api/webhooks/whatsapp`

**Plan tip:** Free instances sleep — WhatsApp webhooks can miss messages while cold. Prefer **Starter** for production WhatsApp.

## Deploy on DigitalOcean App Platform

This repo includes an App Platform spec at `.do/app.yaml`.

1. In DigitalOcean App Platform, create an app from the GitHub repo `ShubhamAnap/engagement-crm`.
2. Import or paste `.do/app.yaml` as the starting spec.
3. Set the required environment variables in App Platform:

| Key | Scope | Notes |
|-----|-------|-------|
| `APP_URL` | Build | First deploy can use the default App Platform URL; update later if you add a custom domain |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Build | Required by Vite at build time |
| `VITE_WIDGET_PUBLIC_KEY` | Build | Same value as `WIDGET_PUBLIC_KEY` |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Run | Server-side Supabase access |
| `WIDGET_PUBLIC_KEY` | Run | Public widget auth |
| `OPENAI_API_KEY` | Run | AI replies, RAG, summaries |
| `CRON_SECRET` | Run | Protects the cron endpoint |
| `CRON_URL` | Run | `https://<your-app-domain>/api/cron/automations` |
| WhatsApp / email / Meta keys | Run | Optional until those channels are enabled |

4. Web service settings in the spec already point to:
   - Build: `bash scripts/render-build.sh`
   - Run: `npm run start:check`
   - Health check: `/api/health`
5. The scheduled job in `.do/app.yaml` calls the automations endpoint every **15 minutes**. DigitalOcean scheduled jobs do not support 5-minute intervals, so this is intentionally slower than the current Render cron. See [DigitalOcean scheduled jobs](https://docs.digitalocean.com/products/app-platform/how-to/manage-jobs/) and the [App Spec reference](https://docs.digitalocean.com/products/app-platform/reference/app-spec/).
6. After the first deploy, update `APP_URL` and `CRON_URL` to the real DigitalOcean app URL, then redeploy.

If you want to deploy with the CLI instead of the dashboard, install `doctl` and run:

```sh
doctl apps create --spec .do/app.yaml
```

## Project docs

- [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) — implementation tracker, phases, decisions
- [`AGENTS.md`](./AGENTS.md) — rules for AI-assisted development

## Product modules

Dashboard · AI Command Center · Inbox · AI Chat · Agents · Knowledge · Products · Customers · Leads · Pipeline · Analytics · Automation · Channels · Human Support · Reports · Settings
