# EnerTech Engage — Project Context & Implementation Tracker

> **Purpose:** Persistent memory for AI + human developers. Read this at the start of every session before making changes.
> **Last updated:** 2026-08-06

---

## Mission

Run **EnerTech Engage** as a **working enterprise AI customer engagement platform** for EnerTech UPS Pvt. Ltd., with architecture that can later become multi-tenant SaaS.

**Current state:** Phases 0–9 are largely live (Supabase + OpenAI + Render). Remaining work is Settings polish (RBAC, encrypted secrets, audit), ops/migrations, and UX hardening — not mock-data migration.
**Approach:** Prefer stabilize and ship focused improvements; new modules only when requested.

---

## What Works Today (Keep)

| Feature | Location |
|---------|----------|
| SSR + client routing | TanStack Start / Router |
| App shell (sidebar, top bar) | `src/routes/__root.tsx`, layout components |
| Theme (dark/light/system) + 5 color palettes + localStorage | `src/lib/theme.tsx`, TopBar + ChatWidget/embed pickers |
| Command palette (Cmd/Ctrl+K) | `src/components/layout/TopBar.tsx` |
| Chat widget UI + live OpenAI reply | `src/components/ChatWidget.tsx` |
| Toast feedback | Sonner |
| shadcn/ui component library | `src/components/ui/` |
| Shared dashboard primitives | `src/components/shared/ui-kit.tsx` |

---

## Tech Stack (Actual)

| Layer | Choice |
|-------|--------|
| Framework | TanStack Start (SSR) — **not** Next.js |
| Bundler | Vite 8 |
| Routing | TanStack Router (file routes in `src/routes/`) |
| Data (planned) | TanStack Query + server functions / API |
| UI | React 19, Tailwind 4, shadcn/ui, Recharts |
| Server | Nitro `node-server` → deploy to **Render** via GitHub |
| Database | **Supabase** (hosted Postgres) |
| Auth | **Email/password** via Supabase Auth |
| AI | **OpenAI GPT-4o-mini** |
| Deploy | GitHub → **Render** (one Web Service) |

**Data:** Modules load from Supabase / server functions (no app-wide mock dataset). The old `src/data/mock.ts` was removed once every route used live APIs.

**TanStack Query** is wired in `src/router.tsx` — use it for client data fetching.

---

## Local Dev Notes

- Run: `npm install` then `npm run dev` → **http://localhost:8080/**
- Production start after build: `npm run build` && `npm start` (Render Web Service)
- On this machine, npm may need SSL workaround due to corporate proxy:
  ```powershell
  $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
  npm install --strict-ssl=false
  ```
- White-labeled as **EnerTech Engage** (no third-party builder footprint).
- Secrets live in **`.env`** (gitignored). User fills keys locally — never paste `service_role` / OpenAI keys into chat. Template: `.env.example`.

---

## Implementation Phases (Build Order)

Implement in this order — each phase unlocks the next.

### Phase 0 — Foundation (DO FIRST)
> Status: **DONE** (core auth + schema)

| # | Task | Why | Status |
|---|------|-----|--------|
| 0.1 | Supabase project + `.env` | Persistence | DONE |
| 0.2 | Schema: `organizations`, `profiles`, roles + grants | Multi-tenant ready | DONE |
| 0.3 | Auth (login, session, protected routes) | Identity | DONE |
| 0.4 | Query for profile (TopBar/Sidebar) | Replace mock user | DONE |
| 0.5 | Shared types | Consistency | DONE (`src/lib/types.ts`) |
| 0.6 | Loading states for auth | Production UX | DONE |

**Exit criteria:** User can log in; API returns real data from DB; shell uses Query instead of mock user. ✅

### Phase 0.5 — Core database schema
> Status: **DONE**

| Table | Purpose | Verified |
|-------|---------|----------|
| `customers` | CRM contacts / accounts | OK |
| `products` | Product catalog | OK |
| `leads` | Lead pipeline | OK |
| `channels` | Website / WhatsApp / Email / … | OK (5 seeded) |
| `agents` | AI agent configs | OK (8 seeded) |
| `conversations` | Inbox + widget threads | OK |
| `messages` | Chat messages | OK |
| `knowledge_collections` | KB folders | OK (8 seeded) |
| `knowledge_documents` | Uploaded docs (embeddings later) | OK |

**File:** `supabase/migrations/003_core_schema.sql`  
**Types:** `src/lib/db-types.ts`

---

### Phase 1 — Settings & Org Config
> Status: **IN PROGRESS** | Route: `/settings`

| Feature | Current | Target |
|---------|---------|--------|
| User profile | Live save (name, phone, title) | **DONE** |
| Email / password | Supabase Auth update | **DONE** |
| Company profile | Admin can save org name/short | **DONE** (run `006_profile_fields.sql`) |
| Branding | Static | **DONE** (logo upload + optional accent; run `015_org_branding.sql`) |
| AI model config | Static | Save OpenAI/API keys (encrypted) (later) |
| Channel credentials | `/channels` | **DONE** (link from Settings) |
| Roles & permissions | Static list | RBAC enforcement (later) |
| Audit logs | Static | Real event log (later) |

**Files:** `src/routes/settings.tsx`, `src/lib/profile-api.ts`, `src/lib/auth.tsx`, `supabase/migrations/006_profile_fields.sql`

---

### Phase 2 — Channels
> Status: **DONE** (Website + WhatsApp + Email + Facebook + Instagram)

| Channel | Integration target | Status |
|---------|-------------------|--------|
| Website | ChatWidget → `conversations`/`messages` + Inbox | **DONE** |
| Website embed | `widget.js` + `/embed` public iframe API | **DONE** |
| Channels UI | Enable/configure + volume stats | **DONE** (`/channels`) |
| WhatsApp | Meta Cloud API webhook + Inbox | **DONE** (configure credentials; needs public HTTPS URL) |
| Email | SMTP outbound + inbound webhook | **DONE** (configure SMTP; point forwarder at webhook) |
| Instagram / Facebook | Meta Graph Page Messaging | **DONE** |
| IndiaMART | Lead Manager Pull + Push → Leads/Inbox + historical backfill | **DONE** (run `007_indiamart_channel.sql`) |

**Files:** `src/routes/channels.tsx`, `src/lib/channels-api.ts`, `src/server/whatsapp.ts`, `src/routes/api/webhooks/whatsapp.ts`, `src/server/email.ts`, `src/routes/api/webhooks/email.ts`, `src/server/meta-messenger.ts`, `src/routes/api/webhooks/facebook.ts`, `src/routes/api/webhooks/instagram.ts`, `src/server/indiamart.ts`, `src/routes/api/webhooks/indiamart.ts`, `src/lib/chat-api.ts`, `src/components/ChatWidget.tsx`, `src/routes/inbox.tsx`

---

### Phase 3 — Customers & Leads
> Status: **DONE** | Routes: `/customers`, `/leads`, `/pipeline`

| Feature | Target | Status |
|---------|--------|--------|
| Customer CRUD | DB table, search, filter | **DONE** |
| Leads CRUD | Real Supabase + Inbox linking | **DONE** |
| Pipeline Kanban | Drag-drop + stage updates on `leads.status` | **DONE** |
| Bulk actions | Assign, export | **DONE** (select rows → assign / status / CSV) |

**Files:** `src/routes/customers.tsx`, `leads.tsx`, `pipeline.tsx`, `src/lib/leads-api.ts`

---

### Phase 4 — Products & Knowledge Base
> Status: **DONE** | Routes: `/products`, `/knowledge`

| Feature | Target | Status |
|---------|--------|--------|
| Product catalog | CRUD, specs, PDFs, stock | **DONE** (CRUD + catalogue PDF upload) |
| Knowledge collections | Real collections in DB | **DONE** (UI + server) |
| PDF / text upload | Storage bucket `knowledge` | **DONE** |
| Image upload per collection | Same bucket; gallery UI | **DONE** |
| Embeddings / RAG index | OpenAI embeddings + **pgvector** | **DONE** (run `004_knowledge_rag.sql`) |
| Chat grounded answers | Retrieve chunks in widget chat | **DONE** |
| Catalogue download links | Bot returns PDF URLs on request | **DONE** |

**Files:** `src/routes/knowledge.tsx`, `src/server/knowledge.ts`, `src/server/embeddings.ts`, `supabase/migrations/004_knowledge_rag.sql`

**Stack locked:** Supabase Storage + pgvector + OpenAI `text-embedding-3-small` (not Pinecone).

---

### Phase 5 — Inbox (Omnichannel)
> Status: **DONE** | Route: `/inbox`

| Feature | Target | Status |
|---------|--------|--------|
| Conversation list | Real-time from channels | **DONE** |
| Thread view | Messages from DB | **DONE** |
| Customer sidebar | Linked CRM profile | **DONE** |
| Send reply | Outbound via channel API | **DONE** (Website/WA/Email/Meta) |
| Filters / search / assign | Wired to state + API | **DONE** (basic) |
| Agent attachments | Image/PDF in thread | **DONE** (Inbox paperclip) |

**Files:** `src/routes/inbox.tsx`, `src/lib/chat-api.ts`

---

### Phase 6 — AI Layer
> Status: **DONE** (v1) | Routes: `/agents`, `/ai-chat`, `/command-center`, `/human-support`

| Feature | Target | Status |
|---------|--------|--------|
| AI Agents | Config per agent (model, prompt, memory) | **DONE** |
| RAG answers | Retrieve from knowledge base | **DONE** |
| Answer inspector | Confidence, sources, reasoning | **DONE** (`/ai-chat` + message metadata) |
| Command Center | Live session monitoring | **DONE** (`/command-center`) |
| Human takeover | Pause AI, assign human | **DONE** |

**Files:** `src/routes/agents.tsx`, `ai-chat.tsx`, `command-center.tsx`, `human-support.tsx`, `src/lib/command-center-api.ts`, `src/lib/ai-chat-api.ts`, `src/server/answer-inspector.ts`

---

### Phase 7 — Automation
> Status: **DONE** (v2 A+B+C) | Route: `/automation`

Trigger → optional conditions → Wait / If-Else → actions. Time-based follow-ups + outbound messaging.

| Feature | Status |
|---------|--------|
| Workflows CRUD + Live/Paused | **DONE** |
| Triggers: lead created / IndiaMART / escalation / status change / follow-up due | **DONE** |
| Conditions: source, priority, channel, lead status | **DONE** |
| CRM actions + assign sales person | **DONE** |
| Outbound: WhatsApp template, email, notify team | **DONE** |
| Due follow-ups cron + Process button | **DONE** |
| Test run + step run log | **DONE** |
| Visual node canvas | **DONE** (`WorkflowCanvas`) |
| Wait / if-else branches | **DONE** (Phase C — WATI-style) |

**Files:** `src/routes/automation.tsx`, `src/components/automation/WorkflowCanvas.tsx`, `src/lib/automations-api.ts`, `src/lib/automation-types.ts`, `src/server/automation-engine.ts`, `src/routes/api/cron/automations.ts`, `supabase/migrations/008_automations.sql`, `012_automation_follow_up_trigger.sql`, `012b_automation_v2.sql`, `016_automation_wait_branch.sql`

---

### Phase 8 — Analytics & Reports
> Status: **DONE** | Routes: `/analytics`, `/reports`, `/` (dashboard)

| Feature | Target | Status |
|---------|--------|--------|
| Dashboard KPIs | Aggregated from real Supabase data | **DONE** (`/`) |
| Charts | Query-driven trend / funnel / channel | **DONE** on dashboard + analytics |
| Analytics Insights | Date range (7/30/90) + live charts | **DONE** (`/analytics`) |
| Reports | Generate + export CSV | **DONE** (`/reports` live catalog + CSV) |

**Files:** `src/routes/index.tsx`, `src/lib/dashboard-api.ts`, `src/routes/analytics.tsx`, `src/lib/analytics-api.ts`, `src/routes/reports.tsx`, `src/lib/reports-api.ts`

---

### Phase 9 — Chat Widget (Customer-Facing)
> Status: **DONE** (v1) | Component: `ChatWidget.tsx`

Embed on EnerTech website — live AI chat, lead capture (name/email/phone required), human handoff banner, image/PDF upload via paperclip.

---

## Module Checklist (Quick Reference)

| Module | Route | Data | Status |
|--------|-------|------|--------|
| Dashboard | `/` | Supabase | Live KPIs + charts |
| AI Command Center | `/command-center` | Supabase | Live sessions: pause/takeover/timeline |
| Inbox | `/inbox` | Supabase | Live + **mobile list→thread**; WA 24h; templates; Recommend product |
| AI Chat Support | `/ai-chat` | Supabase | Live Answer Inspector (confidence, sources, reasoning) |
| AI Agents | `/agents` | Supabase | Live: model/prompt/memory/status; keyword routing; **per-agent allowed tools** |
| Tools | `/tools` | Supabase | Global AI tools catalog (Calculator, Web search); enable/disable; agents opt in |
| Knowledge Base | `/knowledge` | Supabase + Storage | Live collections + upload/index (pgvector RAG) |
| Products | `/products` | Supabase + Storage | CRUD + card image + catalogue PDF (**short link** `/c/{SKU}`) |
| Customers | `/customers` | Supabase | List/create/update/delete |
| Leads | `/leads` | Supabase | **Master sheet** + bulk import CSV (template, skip duplicates, max 500) |
| Pipeline | `/pipeline` | Supabase | Live Kanban from `leads` + drag/select stage updates |
| Analytics | `/analytics` | Supabase | Live Insights: range filter + charts |
| Automation | `/automation` | Supabase | Live A+B+C: Wait, If/Else, conditions, follow-up cron, WA/email/notify, canvas |
| Channels | `/channels` | Supabase | Website + WA + Email + Meta + IndiaMART/TradeIndia **auto sync** + Brainmine |
| Broadcasting | `/broadcasting` | Supabase | WhatsApp templates + **per-recipient variable → CRM column mapping** + Gmail campaigns (CRM / manual / CSV) |
| Human Support | `/human-support` | Supabase | Live handoff queue: claim / resolve / return to AI |
| Reports | `/reports` | Supabase | Live catalog: 7 report types + CSV export |
| Settings | `/settings` | Supabase Auth + org | Live: profile, company (Admin), password, branding |
| Chat Widget | global | Server + Supabase | Live chat + attachment upload + handoff banner |
| Notifications | TopBar bell | Supabase | Live feed: escalations, human queue, unread, new leads, failed automations/broadcasts, WA template status |

**Legend:** `NOT STARTED` → `IN PROGRESS` → `DONE` (update Status column as we go)

---

## Architecture Decisions (Log)

Record decisions here so we don't re-debate.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-30 | Build module-by-module, foundation first | Avoids rework; mock data replaced incrementally |
| 2026-08-03 | Removed unused `src/data/mock.ts` | All modules on live APIs; avoid reintroducing app-wide mocks |
| 2026-07-30 | Keep TanStack Start (don't migrate to Next.js) | Already built on this stack |
| 2026-07-30 | Database = **Supabase Postgres** | User choice; hosted, Auth + storage bundled |
| 2026-07-30 | Auth = **Email/password** (Supabase Auth) | User choice |
| 2026-07-30 | Roles = **Admin, Manager, Agent, Sales** | User-listed roles (confirm RBAC details in Phase 0) |
| 2026-07-30 | AI = **OpenAI** | User has API key available |
| 2026-07-30 | Deploy = **GitHub → Render** | One Web Service; Nitro `node-server` |
| 2026-07-30 | First channel = **Website chat** | User confirmed; WhatsApp/Email later |
| 2026-07-30 | OpenAI model = **GPT-4o-mini** | Cost-efficient default for support agents |
| 2026-07-30 | Supabase = **new project** | Create during Phase 0 |
| 2026-07-30 | Render = **one Web Service** | Single Node SSR deploy for TanStack Start |
| 2026-07-30 | **White-label** as EnerTech Engage | Removed Lovable config, telemetry, branding, `.lovable/` |
| 2026-07-30 | Knowledge RAG = **pgvector + OpenAI embeddings** | No Pinecone for v1; catalogue PDFs via Storage download links |
| TBD | Vector DB scale-out | Stay on pgvector unless search volume outgrows Postgres |
| 2026-08-03 | AI Tools = global `/tools` + per-agent allow-list | Agents only get tools that are enabled globally AND ticked on the agent (`config.allowed_tools`) |
| 2026-08-04 | Website widget origin allowlist | Empty `config.allowed_origins` blocks off-app embeds; subdomains/paths auto; app/localhost/Render always allowed |

---

## Session Log

Brief notes from each working session — append, don't delete.

### 2026-07-30
- **Brainmine Inspect CRM fields (Step A):** Channels → **Inspect CRM fields** pulls one full Lead + DocField/Custom Field meta and lists requirement/query-like keys for mapping approval. **Requirement** ← `query_about`. **Sales Person** ← `opportunity_owner` → `lead_owner` → `_assign` → document `owner` if usable sales email (creator may equal opportunity owner). Skips `customercare@` / non-sales inboxes.
- **Brainmine richer lead fields:** Sync requests CRM source, creation/modified, lead_owner, phone, state/country, industry, etc. New columns `crm_source`, `crm_created_at`, `crm_modified_at` (migration `023`). Leads table shows CRM Source / ID / Created / Modified + CRM source filter. Sales person = `lead_owner` then `owner`.
- **Brainmine auto sync schedule:** Channels → Brainmine **Auto lead sync** — On/Off + custom interval (number + sec/min/hr) + **Save**. Cron pulls latest ≤20 updated leads (upsert). Date-range backfill unchanged.
- **Leads delete by source:** `/leads` → **Delete by source** (Brainmine, IndiaMART, …) with count confirm; also **Delete selected** in bulk bar + source filter on toolbar.
- **Brainmine date-wise extraction:** Channels → Brainmine **From/To** + **Pull date range** (ERPNext `creation` filter, ≤365 days, paginated by leads-per-sync). **Sync leads now** = latest updated only, **max 20**, incremental via `modified`, upserts (no dupes). Date range stays for backfill.
- **Brainmine sync limit + env/UI:** Channels Configure can set leads-per-sync (10–200, default 30). `BRAINMINE_SYNC_LIMIT` in `.env`; UI overrides env. Base URL hint `https://brainmineai.in`. Blank key/secret keeps existing or env credentials.

### 2026-08-04
- **Website widget origin allowlist:** Channels → Website → allowed domains (stored in channel `config.allowed_origins`). Empty list blocks every site except always-allowed preview hosts (`enertechups-ai.onrender.com`, localhost, `VITE_APP_URL` host). Subdomains and paths of an allowed apex are included automatically. Embed passes `parentOrigin` via `widget.js`; server checks `pageOrigin` on all widget APIs (`src/lib/widget-origins.ts`, `assertWidgetAccess` in `widget-chat.ts`).
- **KB reference photos (Website + WhatsApp):** `findReferenceImages` matches application collections (Cold Storage, Petrol Pump, Hospital, Fire, …) when customers ask for install/reference photos. Website chat shows inline image bubbles (tap to open/download). WhatsApp sends real image messages via Cloud API. Upload ready images under Knowledge collections for this to work.
- **Datasheet catalogues:** Catalogue/PDF asks pull from Knowledge **Datasheets** collection. Short links look like `/f/File-Name-aaf86f2d.pdf`. Website shows PDF download chips labeled with the datasheet `.pdf` name (not long Storage URLs).
- **No raw Supabase file URLs to customers:** Replies scrub `/storage/v1/object/public/knowledge/...` (often invented/broken). Verified Datasheets links are appended as absolute app `/f/...pdf` URLs (WhatsApp + Website).
- **File proxy:** `/f/`, `/d/`, `/c/` stream files through Render (service-role download) instead of 302 → supabase.co — fixes mobile `ERR_ADDRESS_UNREACHABLE` when Storage host is blocked.
- **Datasheet `/f/` UUID lookup fix:** Postgres `uuid` does not support `LIKE`; short-id resolve uses UUID range + JS prefix match. Verified all 9 ready Datasheets (incl. BESS) look up and stream (~773KB PDF) on live `enertechups-ai.onrender.com`.
- **WhatsApp mobile PDF:** In-app browser often fails on raw `application/pdf` (“site can’t be loaded”). Catalogues now send as native WhatsApp **document** messages (like photos). `/f/` also serves an HTML download page for normal mobile browsers; Meta fetchers / `?download=1` still get raw PDF.
- **Catalogue matching (no PDF dump):** Agent sends **only the asked product** catalogue (e.g. OnGrid → OnGrid PDF). Vague asks (“catalogue” / “inverter”) get a short numbered list; customer replies with number/name → that one PDF. WhatsApp text is just “Here is the catalogue.” + document.
- **Service Agent (after-sales):** Specialist key `service` — routed on fault/service intent (not working, repair, AMC, complaint, technician visit, …). Edit goal/mission prompt in Agents → Configure. Migration `022_service_agent.sql`.
- **Reference photos UX:** Photo asks reply with only “Sir, here are some reference photos.” + max **3** real images. No invented `![…](164.jpg)` markdown, no “Reference photo: 394 (Cold Storage)” text, no image captions with filenames.
- **Catalogue list memory:** After customer picks from a numbered catalogue list, keep that list so they can reply `2`, `3`, … for another product without asking again.
- **Off-topic guard:** WhatsApp / website / Meta / email refuse general questions (politics, news, etc.) with: “I can only help you with EnerTech products and services. Thank you.” Catalogues, service, photos, greetings still allowed.
- **Ack ignore:** Messages like `ok` / `thanks` / `bye` get **no bot reply** (and never trigger a catalogue). Fixed pending-list bug where `ok` matched the first PDF via empty `[].every()`.

### 2026-08-03
- **Website chat visitor UX:** Embed panel uses EnerTech `#0B2388` / white. Required contact = name, email, phone, location (company optional). After save / returning browser session → chat-only + tiny header **Edit**. Circular launcher remains **ASK EnerTech**. Mic = browser speech-to-text (edit then send).
- **Products bulk CSV import:** `/products` → Bulk import template (sku, name, category, description, stock, qty, price, battery, runtime). Max 500; skip duplicate SKU. Images/PDFs still added one-by-one after import.
- **AI Tools module:** Migration `021_ai_tools.sql` seeds Calculator (on) + Web search (off). Page `/tools` toggles global enable. Agents → Configure ticks allowed tools (`config.allowed_tools`). OpenAI chat loop runs function calls for allowed ∩ enabled tools (widget, WhatsApp, email, Meta). Web search needs `TAVILY_API_KEY` (or `WEB_SEARCH_API_KEY`) on Render.
- **Short catalogue links:** Product catalogues use `https://<app>/c/{SKU}`; knowledge files use `/d/{id}`. AI replies now rewrite any leftover long Supabase Storage URLs before saving/sending.
- **Broadcast lead filters:** WhatsApp broadcast audience (leads / IndiaMART) supports optional AND filters: sales person, status, source, location (e.g. Sales person = Ritesh). Helper `src/lib/broadcast-audience-filters.ts`.
- **WhatsApp template field mapping:** Broadcasting + Automation can map each template variable (`{{1}}` / `{{name}}`) to a CRM column (name, requirement, sales person, …) or fixed text. Send fills values **per recipient/lead**. Helper `src/lib/wa-template-merge.ts`. Prefer Leads/Customers audience so merge fields are available.
- **Retired mock dataset:** Confirmed zero imports of `src/data/mock.ts`; deleted the file. Updated `AGENTS.md` + module checklist so docs no longer describe routes as mock-backed.

### 2026-08-01
- **Product image/PDF upload fix:** Client Storage upload now remove+retries, then falls back to service-role server fn `uploadProductMediaServer` (`src/server/product-media.ts`) — same pattern as Knowledge Base. Clearer errors if `019_product_image.sql` / `005_knowledge_storage_fix.sql` missing. Extension-based MIME when `file.type` is empty.
- **Mobile Inbox:** Phone/tablet uses list-first → full-screen thread (back + profile sheet). Larger touch targets, searchable list, safe-area composer. Floating ChatWidget hidden on `/inbox` so it doesn’t cover the composer.
- **WhatsApp template #132012 fix:** Broadcasting + Inbox detect IMAGE/VIDEO/DOCUMENT headers from synced `components`, require a public media URL at send time, support named body params, and show full Meta error details. Helper `src/lib/wa-template-params.ts`.
- **Gmail campaign fixes:** (1) UTF-8 bodies use base64 MIME (7bit broke Indian chars / ₹). (2) Recipient insert no longer hard-requires `merge_fields` column — falls back to `audience.merge_by_email`. (3) Delayed sends stop before proxy timeout (~55s) and **cron resumes** pending email campaigns (`tickPendingEmailBroadcasts`). Run `020_broadcast_recipient_merge.sql` when you can for per-row merge storage.
- **Gmail campaign CSV audience:** New email campaign → Audience **Upload CSV (campaign only)**. Template includes merge columns; max 500. Rows stored on `broadcast_recipients.merge_fields` (migration `020_broadcast_recipient_merge.sql`) — **not** saved as leads. Helper `src/lib/email-audience-import.ts`.
- **Leads bulk CSV import:** `/leads` → **Bulk import** downloads template, uploads CSV (max 500 rows). Requires name + email or phone; skips existing email/phone. Helper `src/lib/leads-import.ts`.
- **Gmail campaign merge fields:** Subject/body support `{{name}}`, `{{company}}`, `{{email}}`, `{{phone}}`, `{{requirement}}`, `{{sales_person}}`, `{{location}}`, `{{source}}`, `{{status}}`, `{{notes}}` — filled per recipient from Leads/Customers at send time (`src/lib/email-merge.ts`).
- **Gmail campaign send delay:** New email campaign can set min–max seconds (default 4–12). Between each recipient, wait a random time in that range. Stored on broadcast `audience.delay_min_sec` / `delay_max_sec`. WhatsApp broadcasts unchanged.
- **IndiaMART / TradeIndia auto lead sync:** Channels panels have a prominent **Auto lead sync** toggle. ON → cron pulls on preset (every hour / every 6 hours / once a day at IST time). OFF → manual **Sync leads now** only. Settings stored on channel `config` (`auto_sync_*`). Cron `/api/cron/automations` runs `tickIndiaMartAutoSync` + `tickTradeIndiaAutoSync` (skips during backfill/cooldown). Helper `src/lib/marketplace-auto-sync.ts`.

### 2026-07-31
- **WhatsApp product recommendation cards (Path B):** Products store `image_path` / `image_url` (`019_product_image.sql`). Upload image on Products edit. Inbox composer **Recommend** → searchable product picker → sends WhatsApp image+caption (name, price, features, catalogue link) when 24h window open; text-only fallback without image. Server `sendWhatsAppImage` + `sendWhatsAppProductRecommendation`. Meta Catalog (Path A) deferred.
- **Gmail OAuth (n8n-style):** Channels → Gmail: save Client ID/Secret, Connect with Google, disconnect. Callback `/api/oauth/gmail/callback`. Send Email dialog (Text/HTML). Broadcasting → Gmail channel: one-off send + email campaigns. Migration `018_gmail_oauth_broadcast.sql`. Env: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`.
- **Inbox Send template modal:** WACRM-style dialog from composer **Template** button — searchable APPROVED list (name, category, language, preview), then fill vars + send. Component `SendWhatsAppTemplateDialog`.
- **Inbox template compose:** When WA 24h window is closed (or IndiaMART first contact), agents can select an APPROVED template in the chatbox (FileText button next to attach), fill variables, and send via Cloud API — same place as file attach. Server `sendInboxWhatsAppTemplate`.
- **IndiaMART/TradeIndia → WhatsApp contact:** Inbox defaults marketplace lead replies to WhatsApp (phone on lead). Cloud API when 24h session open; first contact opens WhatsApp app / Broadcasting template. Matching WA inbound stamps `wa_last_customer_at` on marketplace threads.
- **WhatsApp 24h session window:** Inbox shows hours remaining on WhatsApp threads; free-form reply/attach blocked when Meta window closed (guide to Broadcasting templates). Migration `017_whatsapp_session_window.sql` (`wa_last_customer_at`). Inbound WA messages open/reset the window; server guards `sendWhatsAppAgentReply`.
- **Render deploy prep:** Added `render.yaml` (Web Service + 5‑min automations cron), `.node-version` (20.18), README deploy section. User deploying to Render for WhatsApp public webhook.
- **Automation Phase C (WATI-style):** Wait (minutes/hours/days) schedules remaining steps in `automation_scheduled_steps`; cron + “Process due + waits” resumes. If/Else branches on lead fields (status, priority, source, phone/email, sales person) with Yes/No action lists. Broader canvas shows Wait + fork nodes. Migration `016_automation_wait_branch.sql`.
- **IndiaMART historical backfill:** Date-range pull splits into ≤7-day chunks, enforces 5-min cooldown between API hits, persists progress on channel `config.backfill`. Channels UI: From/To + Start/Cancel + live status. Auto-tick on setup poll + `/api/cron/automations`. Fixed `loadIndiaMartConfig` to retain `backfill` / `last_api_hit_at`.
- **TradeIndia historical backfill:** Day-by-day (from_date=to_date) to stay within 24h API limit; ~1 min polite gap; Channels UI + cron tick. Same progress pattern as IndiaMART.
- **Leads bulk actions:** Row select → assign sales person, bulk status, Export CSV (selected or current filter).
- **Org branding:** Settings → Company logo upload + optional brand accent hex. Migration `015_org_branding.sql` (columns + `branding` storage bucket). Logo in sidebar; accent overrides CSS primary.
- **Inbox attachments + CSV exports:** Agent paperclip uploads image/PDF to conversation; Customers/Products Export CSV; Dashboard Export downloads KPI CSV.

### 2026-07-30
- Ran app locally at http://localhost:8080/ (npm install needed SSL workaround on user's network).
- Confirmed: entire app is UI prototype with mock data in `src/data/mock.ts`.
- **Goal set:** Add real functionality one component/module at a time.
- Created this `PROJECT_CONTEXT.md` as persistent context.
- **Infra decisions locked:** Supabase Postgres + Auth (email/password), roles Admin/Manager/Agent/Sales, OpenAI GPT-4o-mini, deploy GitHub→Render (one Web Service), first channel Website chat, new Supabase project. Phase 0 ready to start.
- **White-label:** Removed `@lovable.dev/*`, Lovable error telemetry, `.lovable/`, Lovable README/AGENTS branding. Vite config is standard TanStack Start + Nitro `node-server`. Package renamed to `enertech-engage`.
- **Secrets policy:** User fills `.env` locally (gitignored). Template is `.env.example`. Do not ask user to paste service_role / OpenAI keys in chat.
- **Phase 0 started:** Verified `.env` keys present. Added Supabase clients, `organizations`/`profiles` SQL migration, AuthProvider, `/login`, route protection, TopBar/Sidebar wired to real profile, `npm run seed:admin`.
- **Phase 0 auth working:** User ran `001_foundation.sql` + `002_grants.sql`. Admin seeded (`admin@enertechups.com`). Programmatic login verified OK. User confirmed login in browser. **Phase 0 marked DONE.**
- **Phase 0.5 verified:** All 9 core tables OK. Seeded 5 channels, 8 agents, 8 knowledge collections. Ready for Website chat.
- **Website chat:** Wired ChatWidget + Inbox to Supabase `conversations`/`messages`. Placeholder AI replies. Agent can reply from Inbox. Auto-refresh every few seconds.
- **Embed widget:** Public `/embed` route + `public/widget.js` iframe loader + server fns (`src/server/widget-chat.ts`) gated by `WIDGET_PUBLIC_KEY`. Channels page shows copy-paste snippet.
- **Nav audit:** Fixed mobile drawer close-on-navigate, sidebar brand→home, TopBar quick actions + notifications navigate, Channels demo link includes widget key, AI Chat/Agents/Human Support/Analytics header actions wired to real routes. Fake pagination disabled.
- **OpenAI replies:** Added `src/server/openai.ts` and switched website chat replies to server-side `gpt-4o-mini` with fallback responses if OpenAI is unavailable. In-app widget preview now uses the same server flow as the public embed widget. OpenAI credentials smoke-tested successfully.
- **Leads CRUD:** Replaced `/leads` mock table with real Supabase-backed list/create/delete flow. `New lead` now opens a working dialog and each row has a delete action with confirmation.
- **Customers + Products CRUD:** Replaced `/customers` and `/products` mock tables with real Supabase-backed list/create/delete flows. `Add customer` and `Add product` now save real records and each row has a delete action with confirmation.
- **Edit/update flows:** Added edit dialogs for `/leads`, `/customers`, and `/products`, making all three modules full CRUD.
- **Chat record linking:** Website chat now auto-creates/links a `customer` and `lead` for a conversation, and Inbox shows those linked records in the profile panel.
- **Visitor capture:** Public `/embed` widget and in-app preview now collect/save visitor name, email, phone, and company, and sync those details back into linked conversation/customer/lead records.
- **Inbox workflow:** Inbox now exposes linked lead/customer info, quick navigation into CRM pages, and inline lead status/priority updates from the conversation panel.
- **Refresh / new chat:** Inbox Refresh now invalidates + refetches conversations/messages with toast + spinner. EnerBot (in-app + embed) has a **New** button that rotates `widget_session_id`, starts a fresh conversation, and leaves the previous thread saved in Inbox.
- **New chat clears CRM form:** Clicking **New** clears Name / Email / Phone / Company / Location (no autofill from prior visitor or login). Visitor must re-enter details before chatting; Location is stored in conversation/customer/lead `metadata.location`.
- **Blank + smart CRM capture:** Opening Website chat / New always starts blank fields + new conversation. Entering email/phone looks up existing customer and fills only missing fields. Details auto-save; existing customer/lead records are updated for missing fields only (no duplicate customers).
- **Human takeover:** Inbox agent reply sets conversation `status=human` and pauses OpenAI for that thread. Widget polls messages so human replies appear live (labeled “Human agent”). Customer messages while human/escalated are stored without AI replies.
- **Same-contact Inbox merge:** Website chat reuses the contact’s latest open conversation (match by customer/email/phone) instead of creating duplicate Inbox threads. Empty placeholder threads are removed; updated threads rise to the top by `last_message_at`.
- **Inbox resizable layout:** Omnichannel Inbox columns (list / chat / profile) are drag-resizable on desktop; sizes persist in localStorage. Mobile uses a stacked responsive layout. Chat widget sizing improved for small screens.
- **Color palettes:** Five themes (Forest, Ocean, Sunrise, Slate, Teal) work with light and dark mode. Pick via TopBar palette icon or chatbot palette menu; applies site-wide including EnerBot.
- **Knowledge Base + RAG started:** Added `004_knowledge_rag.sql` (pgvector, chunks, match RPC, Storage bucket). `/knowledge` uploads PDF/TXT/MD, embeds with OpenAI, stores vectors in Supabase. EnerBot retrieves chunks and returns catalogue/PDF download links when asked.
- **Upload fix:** Knowledge uploads now prepare a DB row → upload to Storage (browser, with service-role fallback) → index. Added `005_knowledge_storage_fix.sql` for bucket/policies. Word `.doc/.docx` rejected with a clear error; PDF/TXT/MD supported.
- **Collection image galleries:** Collections (e.g. Cold Storage, Petrol Pump) support multi-image upload + gallery view alongside PDFs/TXT. EnerBot can share image links when visitors ask for photos.
- **Product catalogue PDFs:** `/products` Edit/Add can upload a catalogue PDF to Storage (`catalog_pdf_path` / `catalog_pdf_url`). Table shows PDF link; EnerBot already uses these for catalogue requests.
- **Sales Pipeline:** `/pipeline` is a live Kanban over Supabase `leads` (New → … → Won/Lost). Drag cards or use the stage select; **New deal** creates a lead. Shares data with `/leads`.
- **Live Dashboard:** `/` loads real KPIs, 7-day conversation trend, channel split, lead funnel/pipeline charts, recent conversations/leads/products/activity from Supabase (`src/lib/dashboard-api.ts`).
- **Analytics Insights:** `/analytics` is live with 7/30/90-day range — AI share, lead conversion, handle time, conversation trend, funnel, channel performance, top customer questions, agent performance (`src/lib/analytics-api.ts`).
- **Human Support queue:** `/human-support` lists escalated/human conversations from Supabase. Actions: Take over (claim + open Inbox), Resolve, Return to AI. Inbox accepts `?c=<id>` deep link.
- **Channels manager:** `/channels` enables/disables channels in Supabase, configure name/detail/status/health, shows conversation volume, Website embed snippet. Non-website providers mark Action Required until APIs are wired.
- **WhatsApp Meta:** Configure Phone Number ID / Access Token / Verify Token on Channels. Webhook at `/api/webhooks/whatsapp` creates Inbox conversations (`channel=whatsapp`); AI replies outbound via Graph API; Inbox agent replies also send to WhatsApp.
- **Email channel:** Configure From + SMTP on Channels. Inbound webhook `/api/webhooks/email` (JSON or SendGrid form) creates Inbox threads (`channel=email`); AI can reply by SMTP; Inbox agent replies send email. Optional `x-enertech-email-secret`. Env: `EMAIL_*`.
- **AI Agents:** `/agents` loads Supabase `agents` (seeded). **Master = Support** owns every thread; specialists (Sales, Warranty, …) are applied per message when keywords match. Combined system prompt + shared KB/history; Inbox label `AI · Support → Warranty`. Configure model/prompt/memory per agent.
- **Facebook / Instagram:** Meta Page Messaging via `src/server/meta-messenger.ts`. Configure on `/channels`; webhooks `/api/webhooks/facebook` and `/api/webhooks/instagram`; Inbox outbound replies.
- **IndiaMART:** Lead Manager CRM key on `/channels`. **Sync leads now** pulls latest window into Leads (source `indiamart`) + Inbox. **Historical backfill** splits a date range into ≤7-day chunks with 5-min gaps (API limits); progress stored on channel `config.backfill`; cron `/api/cron/automations` also ticks. Push webhook `/api/webhooks/indiamart`. Migration `007_indiamart_channel.sql`.
- **Automation:** `/automation` live workflows (triggers: lead created / IndiaMART / escalation / status change; actions update leads & conversations). Migration `008_automations.sql`. Run history per workflow.
- **Profile / Settings:** `/settings` saves profile (name, phone, job title), email, password; Admins save company name/short. Requires `006_profile_fields.sql`.
- **Reports:** `/reports` live catalog (conversations, pipeline, channels, AI quality, escalations, lead sources, automations). Range 7/30/90; preview KPIs/tables; **Export CSV**. `src/lib/reports-api.ts`.
- **Command Center:** `/command-center` live AI/human/escalated sessions, timeline, pause/resume/takeover, global AI pause.
- **AI Chat + Answer Inspector:** `/ai-chat` lists recent AI replies with confidence, RAG sources, reasoning, hallucination risk. New replies store inspector metadata via `src/server/answer-inspector.ts`.
- **Widget polish:** paperclip uploads image/PDF to Storage; softer lead capture (name/email/phone); human handoff banner + system message on escalate.
- **Automation canvas:** visual trigger→action nodes on `/automation` (edit dialog + detail), reorder actions.
- **Broadcasting:** `/broadcasting` — WhatsApp message templates (create + submit to Meta, Sync from Meta), campaigns to leads/customers/IndiaMART/manual phones. Migration `009_broadcasting.sql`. Needs WABA ID on Channels → WhatsApp.
- **Leads master:** `/leads` is the master enquiry sheet (Company, Name, Email, Phone, Location, Source, Requirement, Sales Person, Status, Note, Tags). Migration `010_leads_master.sql`. Status changes ready for Automation follow-ups later.
- **Brainmine CRM+:** Channels card + Sync now (≤20 latest) + **auto sync** (custom sec/min/hr) + **date-wise Pull date range** → master leads with CRM source/dates/id (`023`). UI overrides `.env`. Migrations `011` + `011b` + `023`.
- **TradeIndia:** Channels card + Sync now (My Inquiry API pull → Leads + Inbox). Dedup by `rfi_id`. **Historical backfill** = one calendar day per pull (~1 min gap), progress on `config.backfill`; cron ticks too. Maps sample fields (sender_*, product_name, subject, message HTML-stripped, inquiry_type). Migrations `014` / `014b` / `014c` (`tradeindia_lead` trigger). Credentials via Channels UI or `TRADEINDIA_*` env — never commit keys.

---

## Rules for AI Agents

1. **Read this file first** at the start of every session.
2. **Update this file** after completing any phase task (status, decisions, session log).
3. **Prefer focused changes** — stabilize live modules; do not reintroduce app-wide mock datasets.
4. **Match existing UI patterns** — use `ui-kit.tsx`, shadcn components, TanStack Query.
5. Prefer clean git history on `main`; avoid force-push unless the user explicitly requests it.
6. Ask user before major infra choices (DB, auth, AI provider) if not logged in Architecture Decisions.
7. Keep product branding as **EnerTech Engage** — no third-party builder names, links, or telemetry.

---

## Open Questions for User

**All Phase 0 blockers answered (2026-07-30).** No open infra questions.

Later (when needed): WhatsApp/Email credentials, brand assets, production domain on Render.

---

## Next Immediate Step

1. **Follow-up Agent daily campaigns** — use Automation → “Suggest today’s follow-up”, or ensure Render cron hits `/api/cron/automations`. Approve in amber bar. Optional `FOLLOWUP_WA_TEMPLATE_NAME`.
2. **Discuss then build:** Human Support queue — latest activity on top; keep human-handled visible.
3. Confirm product image/PDF uploads / pending SQL as needed.
4. Cron: `CRON_URL` + `CRON_SECRET` on Render (every 5 min).
5. Later: DigitalOcean cutover (keep Render until DO proven); Settings RBAC.

---

### Session 2026-08-06 — WhatsApp Meta template sync fix

**Issue:** Sync from Meta often failed or returned empty — usually Phone Number ID used as WABA, missing WABA, or truncated token.

**Fix:** Paginated template fetch + explicit fields; clearer Meta errors (WABA vs phone ID / permissions); auto-discover WABA from phone number when possible; access token max length raised to 2000; Channels WABA field helper text. Broadcasting now also shows `last synced`, `updated`, and Meta ID in template view so edited Meta templates are visibly updated in place.

---

### Session 2026-08-06 — Automation trigger: Brainmine new lead

Added trigger **`brainmine_lead`** (“Brainmine CRM new lead synced”) — fires only on **new** inserts from Brainmine sync (not duplicate updates). Migration `024_brainmine_automation_trigger.sql`.

---

### Session 2026-08-06 — WhatsApp: only requested kW products

WhatsApp sends **only** matching rating/model packs (e.g. 3kW → ~3kW only, max 3). Full-category carousel remains **website-only**.

---

### Session 2026-08-06 — WhatsApp broad product + KB answer

**Issue:** `3kw` on WA → generic “Thanks for messaging…”.

**Fix:** Broader intent (kW, HF, home/residential, category labels). WA uses `presentation: "whatsapp"` (up to 5 full packs). If no Products row → answer from Knowledge Base + products context (4–5 features), never generic welcome.

---

### Session 2026-08-06 — Carousel shows full category

Website carousel expands seed matches to **all active products in that category** (not top 8 only). Soft cap 60.

---

### Session 2026-08-06 — Website product carousel (“I need this”)

**UX:** Product ask (`3kw` etc.) → horizontal swipe cards (photo + name + **I need this**). Tap → Name, Photo, Price, Features, Catalogue only.

**Scope:** Website widget + embed. WhatsApp unchanged (full pack / clarify).

**Files:** `ChatProductCarousel.tsx`, `widgetSelectProduct`, `product-pack` carousel mode.

---

### Session 2026-08-06 — Website chat scroll UX

**Bug:** Widget poll + `scrollIntoView` yanked users back to latest while reading history.

**Fix:** `useStickToBottomScroll` — auto-follow only near bottom or after send/open; history scroll stays put. Applied to `ChatWidget` + `embed`.

---

### Session 2026-08-05 — Strict product card fields only

**Rule:** Customer-facing product share = **Name, Photo, Catalogue, Features, Price** only. No SKU / stock / category / CTAs / “Reference photo” metadata.

---

### Session 2026-08-05 — Use Products + Knowledge Base together

**Principle:** Bot already has Products + KB — objective is a satisfactory answer from that data, not interrogation.

**Fix:** Every AI reply (website / WA / email / Meta) now gets `productsContext` + Knowledge Base. Prompt: answer from both; wait-only if both empty.

---

### Session 2026-08-05 — Auto product pack on kW / price ask

**Request:** “3kw / 4kw / 5kw inverter price” → send full Products pack (photo, catalogue PDF, price, description) — don’t interrogate.

**Fix:** `src/server/product-pack.ts` matches active Products by kW + category; wired before catalogue/AI on website (`widget-chat`) and WhatsApp. Clarify list when several close SKUs; numbered reply picks one.

**Needs:** Products rows with image + PDF + price filled in Products module.

---

### Session 2026-08-05 — Chat: stop breaking conversation

**Problem:** Bot refused “I need inverters” / “Resident” as off-topic; sales flow kept asking location/application/name-style intake after price.

**Fix:**
- `enertech-scope.ts` — plurals (`inverters?`), cities/residential in-scope; active chats don’t hard-block short follow-ups
- Agent + OpenAI prompts — never ask name/email/phone; no price questionnaires; engage with product/catalogue/price from context
- `ENGAGEMENT_LOCK` appended last in `agentReplyConfig` so DB custom prompts can’t override

**Shipped next:** Auto product pack on kW/price (see session above). OpenAI now always receives Products catalogue + Knowledge Base together.

---

### Session 2026-08-05 — Follow-up Agent daily proposals

**Root cause:** Agents → Follow-up was only a **chat prompt**. Editing it to “suggest daily campaigns” did nothing — no cron, no broadcasting, no approval enqueue.

**Fix:** `src/server/followup-agent.ts`
- Daily (cron) or manual **Suggest today’s follow-up** picks open leads needing a nudge
- Creates **one** `automation_approvals` row (amber bar / TopBar shield)
- On Approve → WhatsApp template (or email fallback) per lead + note + next follow-up 48h
- Auto-creates Live workflow “Follow-up Agent · Daily campaign”

**Still true:** Per-lead `next_follow_up_at` + `follow_up_due` workflows remain for scheduled one-by-one follow-ups.

---

### Session 2026-08-04 — Chat UX batch (human-like handoff + service)

**Customer-facing rule:** Never reveal bot/AI or “connecting to human”. Handoff replies sound like a colleague: *“Okay sir, please wait…”* / match session language.

| Item | Status |
|------|--------|
| 1.1 Service intent beats pending catalogue | DONE |
| 1.2 Ack noise only (`ok`/thanks) — keep yes/no | DONE |
| 1.3 Softer commercial scope (delivery/PO/city) | DONE |
| 1.4 Human-like wait handoff (tight triggers) | DONE |
| 2.1 WhatsApp Lead + Customer | DONE |
| 2.2 Website unread bump | DONE |
| 3.1 More photos same collection | DONE |
| 3.2 WA media inbound ack | DONE |
| 4.1 Service structured ticket → quiet escalate | DONE |
| Session language (EN / HI / MR / mixed) | DONE (`src/lib/session-language.ts`) |
| Inbox scroll to latest messages | DONE |
| Inbox **Return to AI** | DONE — header Bot icon only (no banner above composer) |

**Paused for next session (discuss first):**
- Human Support: sort by latest message; ensure claimed/`human` chats still listed.
- Any further Inbox composer polish.

**Key files:** `src/lib/session-language.ts`, `src/lib/conversation-guards.ts`, `src/server/whatsapp.ts`, `src/server/widget-chat.ts`, `src/routes/inbox.tsx`

**Last commits (main):** Return to AI header-only (`e32aafa`), session language (`9793dc9`), handoff UX batch.
