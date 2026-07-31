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
   - **Build:** `bash scripts/render-build.sh`
     (Deletes Windows `package-lock.json` on Linux, installs Rolldown native, runs `vite build`.)
   - **Start:** `npm run start:check` (or `npm start`)
   - **Node:** 20 (`NODE_VERSION=20.18.0` or `.node-version`)
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

## Project docs

- [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) — implementation tracker, phases, decisions
- [`AGENTS.md`](./AGENTS.md) — rules for AI-assisted development

## Product modules

Dashboard · AI Command Center · Inbox · AI Chat · Agents · Knowledge · Products · Customers · Leads · Pipeline · Analytics · Automation · Channels · Human Support · Reports · Settings
