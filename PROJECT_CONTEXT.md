# EnerTech Engage — Project Context & Implementation Tracker

> **Purpose:** Persistent memory for AI + human developers. Read this at the start of every session before making changes.
> **Last updated:** 2026-07-31

---

## Mission

Turn **EnerTech Engage** from a UI/UX prototype into a **working enterprise AI customer engagement platform** for EnerTech UPS Pvt. Ltd., with architecture that can later become multi-tenant SaaS.

**Current state:** foundation/auth/core schema are live; website chat is live with Supabase + OpenAI; many remaining routes still use mock/static data.
**Approach:** Add real functionality **one module at a time**, in dependency order — foundation first, then features.

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

**Mock data:** `src/data/mock.ts` — replace imports module-by-module as each feature goes live.

**TanStack Query** is wired in `src/router.tsx` but unused — use it for all new data fetching.

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

**Next:** Continue replacing remaining mock-driven modules route by route.

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

| Module | Route | Mock source | Status |
|--------|-------|-------------|--------|
| Dashboard | `/` | `mock.ts` | Live KPIs + charts from Supabase |
| AI Command Center | `/command-center` | — | Live sessions: pause/takeover/timeline |
| Inbox | `/inbox` | `mock.ts` | Live conversations/messages with linked customer/lead context and lead workflow actions |
| AI Chat Support | `/ai-chat` | — | Live Answer Inspector (confidence, sources, reasoning) |
| AI Agents | `/agents` | — | Live: model/prompt/memory/status; keyword routing |
| Knowledge Base | `/knowledge` | `mock.ts` | Live collections + upload/index (pgvector RAG) |
| Products | `/products` | `mock.ts` | Real CRUD + catalogue PDF upload (Storage) |
| Customers | `/customers` | `mock.ts` (reuses leads) | Real list/create/update/delete via Supabase |
| Leads | `/leads` | — | **Master sheet**: company, name, email, phone, source, requirement, sales person, status, note, tags, location |
| Pipeline | `/pipeline` | `mock.ts` | Live Kanban from `leads` + drag/select stage updates |
| Analytics | `/analytics` | `mock.ts` | Live Insights: range filter + charts from Supabase |
| Automation | `/automation` | — | Live A+B+C: Wait, If/Else, conditions, follow-up cron, WA/email/notify, canvas |
| Channels | `/channels` | — | Live: Website + WA + Email + Meta + IndiaMART + TradeIndia + Brainmine |
| Broadcasting | `/broadcasting` | — | WhatsApp templates + Meta sync + campaigns |
| Human Support | `/human-support` | `mock.ts` | Live handoff queue: claim / resolve / return to AI |
| Reports | `/reports` | — | Live catalog: 7 report types + CSV export |
| Settings | `/settings` | — | Live: profile, company (Admin), password |
| Chat Widget | global | — | Live chat + attachment upload + handoff banner |
| Notifications | TopBar bell | mock list | Live feed: escalations, human queue, unread, new leads, failed automations/broadcasts, WA template status |

**Legend:** `NOT STARTED` → `IN PROGRESS` → `DONE` (update Status column as we go)

---

## Architecture Decisions (Log)

Record decisions here so we don't re-debate.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-30 | Build module-by-module, foundation first | Avoids rework; mock.ts replaced incrementally |
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
| 2026-07-30 | Knowledge RAG = **pgvector + OpenAI embeddings** | No Pinecone for v1; catalogue PDFs via Storage download links |

---

## Session Log

Brief notes from each working session — append, don't delete.

### 2026-07-31
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
- **Brainmine CRM+:** Channels card + Sync now (read-only pull → master leads, source `brainmine`). Configurable URL/auth/path (ERPNext Lead defaults). Migrations `011` + `011b`. Wire exact field map when API docs arrive.
- **TradeIndia:** Channels card + Sync now (My Inquiry API pull → Leads + Inbox). Dedup by `rfi_id`. **Historical backfill** = one calendar day per pull (~1 min gap), progress on `config.backfill`; cron ticks too. Maps sample fields (sender_*, product_name, subject, message HTML-stripped, inquiry_type). Migrations `014` / `014b` / `014c` (`tradeindia_lead` trigger). Credentials via Channels UI or `TRADEINDIA_*` env — never commit keys.

---

## Rules for AI Agents

1. **Read this file first** at the start of every session.
2. **Update this file** after completing any phase task (status, decisions, session log).
3. **One module at a time** — finish Phase 0 before Phase 5 inbox, etc.
4. **Don't rewrite mock.ts all at once** — migrate each route when its backend is ready.
5. **Match existing UI patterns** — use `ui-kit.tsx`, shadcn components, TanStack Query.
6. Prefer clean git history on `main`; avoid force-push unless the user explicitly requests it.
7. Ask user before major infra choices (DB, auth, AI provider) if not logged in Architecture Decisions.
8. Keep product branding as **EnerTech Engage** — no third-party builder names, links, or telemetry.

---

## Open Questions for User

**All Phase 0 blockers answered (2026-07-30).** No open infra questions.

Later (when needed): WhatsApp/Email credentials, brand assets, production domain on Render.

---

## Next Immediate Step

1. **WhatsApp Meta setup:** Channels → Configure WhatsApp (Phone Number ID, Access Token, Verify Token, WABA) → **Test connection**. For inbound: public HTTPS tunnel + Meta webhook (not localhost).
2. Run `015_org_branding.sql` if logo/avatar storage still fails.
3. Pending migrations if not run: `012`/`012b`, `013`, `014`/`014b`/`014c`, `015`, **`016_automation_wait_branch.sql`** (Wait delays).
4. **Before Render/production deploy:** confirm with user.
5. Still later: RBAC/audit logs, Brainmine field map.
