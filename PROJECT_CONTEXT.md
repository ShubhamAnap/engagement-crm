# Engage CRM — Project Context & Implementation Tracker

> **Purpose:** Persistent memory for AI + human developers. Read this at the start of every session before making changes.
> **Last updated:** 2026-08-19

---

### Session 2026-08-19 — White-label + Multi-org signup

**Change:** White-labeled the entire software — removed all "EnerTech" branding from ~90 files (route titles, meta tags, AI prompts, email templates, chat widget, sidebar). Created `/signup` page where new users create an organization + admin account. Created `/api/signup` server endpoint. Added "Create workspace" link on login page. Sidebar/topbar already reads org name + logo dynamically from the organizations table. Every new org starts on "Free" plan.

**Files:** `src/routes/signup.tsx` (new), `src/routes/api/signup.ts` (new), `src/routes/login.tsx`, `src/routes/__root.tsx`, `src/components/ChatWidget.tsx`, `src/components/layout/AppSidebar.tsx`, `src/lib/brand.ts`, `src/routes/api/health.ts`, plus ~40 route/lib/server files with EnerTech strings genericized.

---

### Session 2026-08-19 — DigitalOcean deploy prep

**Change:** Prepared the repo for DigitalOcean App Platform. Added `.do/app.yaml` with a Node web service plus scheduled cron job, documented DO deploy steps in `README.md`, and cleaned `scripts/run-migrations.mjs` so it no longer stores project tokens in source. Note: DigitalOcean scheduled jobs support a minimum 15-minute interval, so cron there is slower than the previous 5-minute Render setup.

**Files:** `.do/app.yaml`, `README.md`, `scripts/run-migrations.mjs`.

---

### Session 2026-08-19 — Channels page layout reorder

**Change:** On `/channels`, the platform channel cards grid (toggles, Configure, connection health) now appears first below the page header. Stat cards, Gmail OAuth, Website embed, and all other setup panels follow below. UI-only reorder — no config or API logic changed.

**Files:** `src/routes/channels.tsx`.

---

### Session 2026-08-19 — Real channel logos

**Change:** Channel marks (except Brainmine BM and Website globe) now use official logo files in `public/channel-logos/`: WhatsApp / Facebook / Gmail / WordPress from Wikimedia Commons SVGs; Instagram, IndiaMART, TradeIndia from each platform’s public icon. Letter placeholders IM / TI / W are gone.

**Files:** `src/components/shared/ChannelBrandMark.tsx`, `public/channel-logos/*`.

---

### Session 2026-08-19 — Navy gradient on section chrome

**Change:** Sidebar navy→bright-navy gradient is now the same token as primary buttons, page titles, Panel top bars, and channel-card rails. Status pills stay green/orange (live vs setup). Channel logos stay official (WA/Meta/IndiaMART). `--et-grad-from` follows `--primary` so org brand and chrome cannot drift into two blues.

**Files:** `src/styles.css`, `src/components/ui/button.tsx`, `src/components/shared/ui-kit.tsx`, `src/routes/channels.tsx`.

---

### Session 2026-08-19 — Brainmine-inspired boxes (navy)

**Change:** Keep one navy accent. Copy Brainmine CRM box language: gray canvas vs white cards, stronger borders, navy→bright-navy gradient on the active sidebar pill, short title underline on Panels, 3px gradient bar under StatCards, and filled Input/Select/Textarea/TopBar search (not ghost lines). Not a green Brainmine clone. Inbox thread skins unchanged.

**Files:** `src/styles.css`, `src/components/layout/AppSidebar.tsx`, `src/components/layout/TopBar.tsx`, `src/components/shared/ui-kit.tsx`, `src/components/ui/input.tsx`, `src/components/ui/textarea.tsx`, `src/components/ui/select.tsx`.

---

### Session 2026-08-18 — World-class EnerTech theme

**Change:** One navy accent, quiet navy-black surfaces, locked semantic colors. Palettes (Forest/Ocean/Sunrise/Teal/Slate) and the TopBar rainbow picker are gone. Light / Dark / System remain. Org `brand_primary` hex is converted to oklch (never written raw onto tokens). Settings brand picker defaults to EnerTech navy `#0B2388`. Inbox WhatsApp/IndiaMART skins stay on the **thread** only; conversation list + profile use app surfaces. Hardcoded `amber-*` warnings now use `text-warning` / `bg-warning`.

**Files:** `src/styles.css`, `src/lib/theme.tsx`, `src/lib/color.ts`, `src/lib/brand.ts`, `src/lib/auth.tsx`, `src/lib/channel-brand.ts`, `src/components/layout/TopBar.tsx`, `src/components/layout/AppSidebar.tsx`, `src/components/ui/tooltip.tsx`, `src/routes/login.tsx`, `src/routes/settings.tsx`, `src/routes/inbox.tsx`, plus semantic-token swaps on agents/tools/channels/leads/knowledge/pipeline.

---

### Session 2026-08-18 — Inbox sidebar actions (not timezone)

**Change:** Inbox right panel is now an action desk. Dropped hardcoded timezone, duplicate last-seen/assigned/status, truncated IDs, session id, and the fake AI confidence bar. Added assign (EnerBot or a teammate — pauses AI), labels (presets + freeform on `conversations.tags`), and a private internal note (`metadata.internal_note`). Open customer / Open lead jumps to that record. Lead status/priority, Brainmine follow-up, and conversation summary stay.

**Files:** `src/components/inbox/InboxProfileSidebar.tsx`, `src/routes/inbox.tsx`, `src/lib/chat-api.ts`, `src/lib/inbox-snooze.ts`, `src/lib/leads-api.ts`, `src/lib/customers-api.ts`, `src/routes/leads.tsx`, `src/routes/customers.tsx`.

---

### Session 2026-08-18 — Settings → AI Gateway

**Change:** Admin-only **AI Gateway** tab in Settings. Org-wide provider (OpenAI live; Claude/Gemini listed as coming soon), default chat model, fallback model, and summary model. Embeddings stay locked to `text-embedding-3-small` (pgvector 1536-d). The live gateway loads these from `llm_gateway_settings` with a short in-memory cache. Per-agent Model on `/agents` still wins; agents can choose **Org default** to follow this tab. New specialists are created as Org default.

**Ops:** Run `038_llm_gateway.sql` in the Supabase SQL Editor (after `037` if spend tables are not in yet). Until then the tab shows a “run SQL” empty state and chat keeps using env defaults (`OPENAI_MODEL` / `OPENAI_FALLBACK_MODEL`).

**Files:** `supabase/migrations/038_llm_gateway.sql`, `src/server/llm-gateway-settings.ts`, `src/server/llm-gateway.ts`, `src/server/openai.ts`, `src/server/embeddings.ts`, `src/server/conversation-summary.ts`, `src/components/settings/LlmGatewaySettingsPanel.tsx`, `src/routes/settings.tsx`, `src/routes/agents.tsx`, `src/lib/agent-prompts.ts`, `src/lib/agents-api.ts`.

---

### Session 2026-08-18 — Brainmine quotation probe

**Change:** Added a separate read-only Brainmine quotation probe so staff can test whether a known Quotation record exposes direct PDF hints, file attachments, or only raw quote data. This path is isolated from lead sync and follow-up write-back.

**Scope:** Probe uses a quote id + doctype, fetches the Quotation document, inspects link-like fields, checks linked `File` records, and classifies the result as `pdf_available`, `quote_data_only`, or `insufficient`.

**Files:** `src/server/brainmine-quotation.ts`, `src/routes/channels.tsx`.

---

### Session 2026-08-18 — LLM gateway foundation

**Change:** Added a lightweight internal LLM gateway so OpenAI calls are centralized behind one server-side wrapper. Existing behavior is preserved while chat completions, embeddings, and conversation summaries now share common timeout, retry, and spend-logging logic. The gateway also owns per-feature default model policy and optional fallback-model scaffolding. WhatsApp, website, email, and Meta inspector labels now use `resolveLlmModel()` instead of hardcoded `gpt-4o-mini`.

**Scope:** Phase 1 foundation only. OpenAI remains the active provider. No UI or agent behavior changes intended; this is an internal standardization layer for safer future routing, fallback, and observability work.

**Files:** `src/server/llm-gateway.ts`, `src/server/openai.ts`, `src/server/embeddings.ts`, `src/server/conversation-summary.ts`, `src/server/agents.ts`, `src/server/whatsapp.ts`, `src/server/widget-chat.ts`, `src/server/email-core.ts`, `src/server/meta-messenger.ts`.

---

### Session 2026-08-18 — AI Agents backlog (honest UI + routing + bind)

**Change:** Agents page now matches live chat. Specialist stats count last-routed `metadata.specialist_key` (not Master thread ownership). Memory switch is Master-only. Tools union is explained (specialist cannot disable Master tools). Configure shows always-on engagement lock (not weakened). Pause-Master copy matches fallback. Routing sticks on short follow-ups, splits battery-price vs sizing and service vs buy-new. Test classify warns about WhatsApp shortcuts. Optional Knowledge collections + product categories per agent. Extra routing keywords + Add specialist (no migration). Calculator can run Formulas-page expressions. Model list includes gpt-5-mini/nano.

**Files:** `src/routes/agents.tsx`, `src/lib/agents-api.ts`, `src/lib/agent-routing.ts`, `src/lib/agent-prompts.ts`, `src/lib/agent-config.ts`, `src/server/agents.ts`, `src/server/knowledge.ts`, `src/server/product-pack.ts`, `src/server/ai-tools.ts`, WhatsApp/widget/Meta/email reply paths.

---

### Session 2026-08-18 — API spend tracker (Dashboard)

**Change:** Admin Operations Dashboard shows this-month OpenAI ₹, WhatsApp ₹, total ₹, vs last month, a daily IST table, and Export CSV. Spend is logged from real OpenAI `usage` and WhatsApp outbound send type — not Command Center token guesses or Inbox bubble counts.

**Schema:** `api_spend_events` + `cost_rates` (gpt-4o-mini USD/1M, embeddings USD/1M, WhatsApp India INR per message, `fx.usd_inr`). Session WA = service (₹0); templates use MARKETING unless the template row is UTILITY. Inserts are best-effort (never block chat).

**Ops:** Run `037_api_spend.sql` in the Supabase SQL Editor. Past months stay empty until logging starts. Edit `cost_rates` when Meta/OpenAI change prices.

**Files:** `supabase/migrations/037_api_spend.sql`, `src/server/api-spend.ts`, `src/lib/spend-math.ts`, `src/lib/spend-api.ts`, `src/server/openai.ts`, `src/server/embeddings.ts`, `src/server/conversation-summary.ts`, `src/server/whatsapp.ts`, `src/server/whatsapp-broadcast.ts`, `src/routes/index.tsx`, `src/lib/db-types.ts`.

---

### Session 2026-08-14 — ASK header subtitle

**Change:** Chat header under **EnerTech** shows: “Ask Anything About Our Products & Services”. Same on live `/embed` and in-app ASK preview. Copy only — send/replies unchanged.

**Files:** `src/routes/embed.tsx`, `src/components/ChatWidget.tsx`.

---

### Session 2026-08-14 — ASK launcher gentle pulse

**Change:** Website ASK EnerTech button (`widget.js`) slowly scales 1.00→1.08 while closed so it is easier to notice. Stops when the chat opens, after ~20s, or if the visitor prefers reduced motion. Same pulse on the in-app ASK preview. Chat send/replies unchanged.

**Files:** `public/widget.js`, `src/lib/ask-launcher-pulse.ts`, `src/components/ChatWidget.tsx`, `src/styles.css`.

**Fix (2026-08-14):** Pulse import had landed inside the visitor-profile import and broke Render `vite build`. Restored a valid import.

---

### Session 2026-08-13 — Knowledge: one upload surface when empty

**Change:** Empty collection no longer stacks a second “Choose images” empty state under the drop zone. Drop zone + header Add images / Add PDF stay. Upload logic unchanged.

**Files:** `src/routes/knowledge.tsx`.

---

### Session 2026-08-13 — Products grid page size 24

**Change:** Catalog page size 25 → 24 so card rows fill evenly at 2 / 3 / 4 columns (no leftover gap on the last row of a page).

**Files:** `src/routes/products.tsx`.

---

### Session 2026-08-13 — Desk beautification (paint only)

**Change:** Visual identity across the live desk. No send/sync/Brainmine/Woo logic change.

- Inbox thread skins follow the open channel (WA / IndiaMART / email / TradeIndia / FB / IG / website). List avatars use brand color.
- Products default to a photo card grid (table toggle kept).
- Default chrome is EnerTech navy (one accent). Rainbow palettes removed in the 2026-08-18 theme pass.
- Login mark is EnerTech “E”. Staff ChatWidget hidden on Inbox and Channels (white overlay).
- Leads/Pipeline/Human Support: source/stage color accents. Dashboard + Analytics charts use brand hex.
- Knowledge collections look like albums. Broadcast templates preview as a WhatsApp bubble. Customers get avatars; dummy Filter/Sort hidden. Command Center live dot.

**Files:** `src/styles.css`, `src/lib/theme.tsx`, `src/lib/channel-brand.ts`, `src/routes/inbox.tsx`, `src/routes/products.tsx`, `src/routes/login.tsx`, `src/routes/__root.tsx`, `src/routes/leads.tsx`, `src/routes/pipeline.tsx`, `src/routes/knowledge.tsx`, `src/routes/broadcasting.tsx`, `src/routes/index.tsx`, `src/routes/analytics.tsx`, `src/routes/customers.tsx`, `src/routes/command-center.tsx`, `src/routes/human-support.tsx`.

---

### Session 2026-08-13 — Sidebar group order

**Change:** Sidebar (and Settings permission groups) now read Operate → Commerce → Intelligence → Insight. Items stay in their groups. Routes and access rules unchanged.

**Files:** `src/components/layout/AppSidebar.tsx`, `src/lib/permissions.ts`.

---

### Session 2026-08-13 — Sidebar Collapse on top; Products Filter/Sort

**Change:** Sidebar Collapse moved from the footer to the header (next to the logo). Product Catalog Filter and Sort are wired: category / stock / WordPress vs manual, and name / SKU / category / price / newest. Previously Toolbar rendered disabled placeholder buttons.

**Files:** `src/components/layout/AppSidebar.tsx`, `src/routes/products.tsx`.

---

### Session 2026-08-13 — Channel brand identity (Channels + Inbox)

**Change:** Each channel uses official brand color + a small original mark (WA green bubble, IndiaMART IM, etc.). Channels cards get an accent bar + avatar; Inbox list/thread chips match. Connect/send logic unchanged. No Meta embedded onboarding.

**Files:** `src/lib/channel-brand.ts`, `src/components/shared/ChannelBrandMark.tsx`, `src/components/shared/ui-kit.tsx`, `src/routes/channels.tsx`, `src/routes/inbox.tsx`.

---

### Session 2026-08-13 — Inbox snooze, Pause AI, last-seen strip

**Change:** Inbox thread header: last seen + IST, labeled Pause AI / Return to AI, and a Remind popover (1h/6h/12h/24h + datetime). Snooze is `conversations.metadata.inbox_snooze_until` only — not Lead/Brainmine. Cleared on customer inbound or agent send.

**Files:** `src/routes/inbox.tsx`, `src/lib/chat-api.ts`, `src/lib/inbox-snooze.ts`, `src/server/whatsapp.ts`, `src/server/widget-chat.ts`.

---

### Session 2026-08-13 — Sale price + MRP on products and chat

**Change:** Woo selling/sale price stays on `price_label`; regular price stored as `mrp_label`. Products table/form show both. WhatsApp/chat: `Price: ₹45,000 (MRP ₹52,000)` when they differ.

**Ops:** Run `036_product_mrp.sql`, then Sync from WordPress.

**Files:** `supabase/migrations/036_product_mrp.sql`, `src/server/wordpress-catalog.ts`, `src/lib/product-card.ts`, `src/lib/products-api.ts`, `src/routes/products.tsx`.

---

### Session 2026-08-13 — Category catalogue PDFs (one per category)

**Approved:** Upload one catalogue PDF per product category. All SKUs in that category inherit it at read time (WhatsApp pack, `/c/{sku}`, Products table). A product-level PDF still overrides. Woo sync does not copy the file onto each row.

**Ops:** Run `035_category_catalogues.sql` in Supabase SQL Editor. Then Products → Category catalogues → Upload.

**Files:** `supabase/migrations/035_category_catalogues.sql`, `src/lib/product-card.ts`, `src/lib/products-api.ts`, `src/routes/products.tsx`, `src/routes/c.$sku.ts`, `src/server/product-pack.ts`, `src/server/product-media.ts`.

---

### Session 2026-08-13 — Rating spec must not defer to sales

**Bug:** After `requirement_submitted` (Ritesh assigned), `25kva 360vdc 3ph hybrid pcu` matched sales-owner defer (`kVA` = transactional) and never hit product pack. Catalog updates could not help.

**Fix:** `isProductRatingSpecAsk` skips sales defer so WhatsApp/widget run product match. PCU / VDC / 3ph added to product scoring. Petrol-pump reference photos still skip sales (existing).

**Files:** `src/lib/conversation-intent.ts`, `src/server/product-pack.ts`.

---

### Session 2026-08-13 — Woo sync empty because theme HTML prefixed REST JSON

**Bug:** Sync showed “No published Woo products found” even though the Store API has products. YITH/Wishlist (and similar) print HTML before JSON; `JSON.parse` failed and we treated it as zero products.

**Fix:** Strip leading HTML and parse from the first `[`/`{`. REST v3 tries query-param auth then Basic; retry without `status=publish` if the first page is empty.

**Files:** `src/server/wordpress-catalog.ts`.

---

### Session 2026-08-13 — Inbox conversation summary is human-editable

**Change:** Conversation Summary in Inbox is a textarea. Generate still fills it; humans can correct it and **Save edits**. Update lead / Brainmine push use the saved text (`ai_summary_source=human`), not a silent AI overwrite.

**Files:** `src/routes/inbox.tsx`, `src/server/conversation-summary.ts`.

---

### Session 2026-08-13 — WordPress / WooCommerce catalog pull

**Decision:** WordPress is catalog master (pull-only). Engage does not push products back. Images/PDFs stay on WP as public HTTPS URLs.

**Build:** Channels → WordPress / WooCommerce: Inspect (Store API, no keys) + Sync now. Woo REST v3 keys optional for prices, descriptions, download PDFs. Upsert by SKU or `WOO-{id}`/slug. Sale price over regular. Published only; missing Woo rows marked inactive. Product pack limit 400. `/c/{sku}` redirects to external HTTPS PDFs.

**Ops:** Run `034_wordpress_channel.sql` then `034b_wordpress_channel_row.sql` in Supabase. Paste Woo Consumer Key/Secret in Channels (or `WOO_*` env). Then Inspect + Sync.

**Files:** `src/server/wordpress-catalog.ts`, `src/routes/channels.tsx`, `src/routes/products.tsx`, `src/lib/product-card.ts`, `src/routes/c.$sku.ts`.

---

### Session 2026-08-13 — Reference photos must not defer to sales

**Bug:** “Refrence of petrol pump” matched sales-owned commercial defer (`reference` in transactional regex) and replied with Mr. Ritesh instead of KB petrol-pump photos.

**Fix:** `wantsSalesOwnedCommercialDefer` skips site/install/reference photo asks so WhatsApp continues to `findReferenceImages`.

**Files:** `src/lib/conversation-intent.ts`.

---

### Session 2026-08-13 — Poultry install photos vs product card; AI Hi reply

**Bugs:** (1) “installations of poultry” hit product pack (use-case + short text) instead of KB site photos. (2) AI-owned WhatsApp threads stayed silent on next-day Hi because greetings were skipped on non-cold chats.

**Fix:** `wantsSiteInstallOrReferencePhotos` before product pack; Hi/Ho on AI-owned threads get a short greeting (5 min debounce).

**Files:** `conversation-intent.ts`, `knowledge.ts`, `product-pack.ts`, `enertech-scope.ts`, `whatsapp.ts`, `widget-chat.ts`.

---

### Session 2026-08-13 — Keep full sales name in defer replies (Mr. Amol, not A)

**Bug:** `requirement_submitted` template `*Mr. Amol*` was parsed as `A` because a non-greedy regex stopped at one letter. Defer reply became “A is handling…”.

**Fix:** Parse starred full names, require ≥2 letters, keep honorific; fallback to lead `sales_person`.

**Files:** `src/lib/conversation-intent.ts`, `src/server/whatsapp.ts`, `src/server/widget-chat.ts`.

---

### Session 2026-08-12 — Customer-first conversation summaries

**Approved:** Summaries prioritize customer messages; ignore WhatsApp templates, catalogue/PDF product-pack sends, and generic AI filler. Products only if the customer named them. Line 1 = customer’s main ask (callback / person / quote).

**Files:** `src/server/conversation-summary.ts`.

---

### Session 2026-08-12 — Inbox summary → Leads overwrite + pending Brainmine push

**Approved:** Each Inbox **Generate summary** overwrites Engage **Follow-up summary** + **Next follow-up** (+4 days); marks `brainmine_followup_pending`. Brainmine append-only (new Follow Up row per push). Push only **pending** follow-ups (updated since last CRM write). Leads toolbar **Push pending to Brainmine** + bulk **Push selected (pending)**; **Pending CRM push** badge on grid.

**Files:** `src/lib/follow-up.ts`, `conversation-summary.ts`, `brainmine-writeback.ts`, `leads-api.ts`, `inbox.tsx`, `leads.tsx`.

---

## Mission

Run **EnerTech Engage** as a **working enterprise AI customer engagement platform** for EnerTech UPS Pvt. Ltd., with architecture that can later become multi-tenant SaaS.

**Current state:** Phases 0–9 largely live. Enterprise hardening Phases **1–3** shipped; **Phase 4 RAG quality** shipped. Soft Meta signature (advisory) until App Secret is verified. **Team permissions** — run `033`. **Knowledge Base A+B+C** — run `032` if needed. **Agents/Tools** + **Leads A+B** deployed. **Website Widget A+B** ready (is_enabled, embed attach, EnerTech typing) — deploy when asked. **Ops:** `029`→`036` as needed; public `APP_URL` for photo links. Category PDFs: run `035`. Dual prices: run `036` then Sync WordPress.
**Approach:** Prefer stabilize and ship focused improvements; new modules only when requested.

---

## What Works Today (Keep)

| Feature | Location |
|---------|----------|
| SSR + client routing | TanStack Start / Router |
| App shell (sidebar, top bar) | `src/routes/__root.tsx`, layout components |
| Theme (dark/light/system) + localStorage | `src/lib/theme.tsx`, TopBar |
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
| AI Chat Support | `/ai-chat` | Supabase | Live Answer Inspector + **tools used** pills |
| AI Agents | `/agents` | Supabase | Master + specialists; test classify; Admin-only save; effective tools |
| Tools | `/tools` | Supabase | Global enable + API-key hints + agents-using-tool; Admin-only; stale allow-list clean |
| Knowledge Base | `/knowledge` | Supabase + Storage | Live collections + upload/index (pgvector RAG) |
| Products | `/products` | Supabase + Storage | CRUD + card image + catalogue PDF (`/c/{SKU}`); category PDF inherit; Price + MRP |
| Customers | `/customers` | Supabase | List/create/update/delete |
| Leads | `/leads` | Supabase | Master sheet: **paged** filters, CRM toggle, Add/Edit privileges, safe delete-by-source |
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
| 2026-08-11 | Runtime tools = Master ∪ specialist ∩ global | Chat unions Master + active specialist allow-lists, then intersects with globally enabled tools |
| 2026-08-11 | Agents/Tools mutations Admin-only | Configure/save agent + enable tools restricted to Admin; others view-only |
| 2026-08-04 | Website widget origin allowlist | Empty `config.allowed_origins` blocks off-app embeds; subdomains/paths auto; app/localhost/Render always allowed |

---

## Session Log

Brief notes from each working session — append, don't delete.

### Session 2026-08-12 — Inbox: show Meta WhatsApp fail reason

**Done:** Webhook stores `wa_error` + `wa_error_code` on Failed; Inbox shows code + short Meta message (hover for full). Explains template “Failed” after API accept.

**Status:** Code ready — say **deploy** to commit/push.

### Session 2026-08-12 — Leads tiny WhatsApp icon → Inbox

**Done:** Phone cell shows a small WhatsApp icon when the lead has a valid number. Opens existing WA/marketplace thread or creates one, then `/inbox?c=…`.

**Status:** Code ready — say **deploy** to commit/push.

### Session 2026-08-12 — AI: don’t pretend we can’t see shared PDFs

**Issue:** After proforma/catalogue PDF, “Okay sir” / “details mentioned in this” got a ChatGPT-style “I don’t have access to files” reply.

**Done:** Inject last shared document (filename/URL) into OpenAI history; prompt lock; short commercial ack after outbound PDF (WhatsApp / widget / Meta); persist product-pack catalogue rows in chat history.

**Status:** Code ready — say **deploy** to commit/push.

### Session 2026-08-12 — Conversation Summary Agent v1 + Leads bulk Brainmine push

**Approved:** AI bilingual summary (policy C), Inbox generate + Update lead (+ optional Brainmine), Leads bulk **Push follow-ups to Brainmine**, keep Channels batch, CRM ✓ indicator on Follow-up summary column.

**Files:** `conversation-summary.ts`, `brainmine-writeback.ts` (prefer AI summary; `writeBrainmineFollowUpsForLeads`), `inbox.tsx`, `leads.tsx`.

**Status:** Code ready — say **deploy** to commit/push.

### Session 2026-08-11 — Write-back: notes fallback + verify CRM row

**Issue:** Toast looked successful but dummy lead (note only, no WhatsApp chat) was skipped; CRM Follow Up Description stayed empty.

**Done:** Summary from chat → else `follow_up_summary` → else Note; brainmine_id or external_ref; minimal PUT + verify Description on CRM; honest toast when written=0.

**Status:** Code ready — say **deploy**.

### Session 2026-08-11 — Follow up type casing Whatsapp

**Goal:** Fix Select validation — CRM allows Phone / Whatsapp / Email (not WhatsApp).

**Done:** Default + normalize `type_value_whatsapp` → `Whatsapp`.

**Status:** Deploying.

### Session 2026-08-11 — Write-back Contact match priority

**Goal:** Match CRM Contact by any customer field; phone first.

**Done:** Contact with resolve order: WhatsApp/phone → email → company_name → visitor/lead name. Omit Link if none match (no raw company as Link value).

**Status:** Code ready — say **deploy** to commit/push.

### Session 2026-08-11 — Write-back Contact by WhatsApp

**Goal:** Fix LinkValidationError (`Contact with: Globe International`).

**Done:** Follow up type stays WhatsApp; Contact with resolves CRM Contact by WhatsApp phone (omit if no Link match); only WhatsApp threads are written; company name never sent as Contact link.

**Status:** Code ready — say **deploy** to commit/push.

### Session 2026-08-11 — Inspect write-back fields (Brainmine Follow Up)

**Goal:** Fix write-back “Could not find Follow Up child table” by discovering the real API fieldname.

**Done:** Channels button **Inspect write-back fields** (sample Opportunity child tables + DocField/Custom Field Table meta) + **Save mapping** into `channels.config.writeback`. Empty-table detection falls back to configured table name on PUT.

**Status:** Code ready — say **deploy** to commit/push.

### Session 2026-08-11 — Leads edit: follow-up summary + clickable cells

**Goal:** Edit next follow-up date, follow-up summary, and notes from the master sheet.

**Done:** Follow-up summary field in Add/Edit lead dialog (saved to `metadata.follow_up_summary`); click Next follow-up / Follow-up summary / Note cells opens edit when user has leads_create.

**Status:** Code ready — say **deploy** to commit/push.

### Session 2026-08-11 — Brainmine follow-up write-back + Leads summary column

**Goal:** Write conversation follow-ups back to Brainmine CRM without touching lead sync; show summary on Leads.

**Done:**
- Separate write-back path (`src/server/brainmine-writeback.ts`) — manual **Write follow-ups to Brainmine** on Channels; does not call sync/ingest.
- Field map: type=WhatsApp, contact=name, next date=+4 days, description=conversation summary; match by `brainmine_id`.
- Stores `metadata.follow_up_summary` (+ write stamps); Leads grid: **Next follow-up** date + **Follow-up summary** (`line-clamp-2`).
- Lead edit preserves existing metadata (so summary / CRM ids are not wiped).

**Out of v1:** Cron auto write-back; changing sync ingest.

**Status:** Code ready — say **deploy** to commit/push.

### Session 2026-08-11 — Website chatbot Widget A+B

**Goal:** Stabilize embed + in-app chat without touching welcome WA / CRM→Automation wiring.

**A:** Website `is_enabled` gate; filter visitor messages on all returns; embed paperclip parity; Channels key/allowlist + `website_visitor_captured` ≠ `lead_created` notes; widget-demo checklist.
**B:** Shared profile helper (location optional); EnerTech-only typing (no AI/human labels or Request human); new-chat confirm; mobile safe-area; welcome copy = EnerTech.

**Unchanged:** `syncConversationIdentity`, welcome trigger, contact phone/email gate for Inbox, no `lead_created` on widget lead insert.

**Status:** Code ready — say **deploy** to commit/push.

### Session 2026-08-11 — Leads A+B (master sheet polish)

**Goal:** Ops-ready master sheet without breaking CRM sync ↔ Automation columns/triggers.

**A:** Server paged list (`listLeadsPage` 50/page + exact total); filters (sales person, priority, follow-up due); CRM columns toggle; Priority + Follow-up in grid; Channels/Pipeline links; CSV Engage Ref vs CRM ID fix; working TablePagination.
**B:** `leads_create` = Add/Edit/import/bulk assign+status; typed confirm + DB count for delete-by-source; import progress + optional skip automations on CSV only.

**Unchanged:** CRM field names, `lead_created` / `lead_status_changed`, Pipeline `updateLeadStatus`, Channels sync.

**Status:** Code ready — say **deploy** to commit/push.

### Session 2026-08-11 — Agents A+B then Tools A+B

**Goal:** Long-term clarity on Master/specialists + honest tool ops (before deploy).

**Agents A:** Architecture panel; Follow-up chat ≠ Automation daily campaign; Admin-only save/toggle; shared `src/lib/agent-routing.ts`.
**Agents B:** Confirm before pausing Master; effective tools (Master ∪ specialist ∩ global); test-classify box; Degraded → Active|Paused UX.
**Tools A:** Runtime/API-key hints; agents using each tool; stale allow-list warn + optional strip on disable.
**Tools B:** OpenAI returns `toolsUsed` → Inspector `metadata.tools_used` + AI Chat pills; Admin-only tool toggle.

**Files:** `agents.tsx`, `tools.tsx`, `tools-api.ts`, `agent-routing.ts`, `openai.ts`, `answer-inspector.ts`, channel reply paths, `ai-chat*`.

**Status:** Code ready — say **deploy** to commit/push Render.

### Session 2026-08-11 — Leads Add / Delete privileges

**Shipped:** Team ticks `leads_create` / `leads_delete` under Leads section. Default off even when Leads is open. Leads UI hides Add / Bulk import / Delete actions; API asserts same.

### Session 2026-08-11 — Products catalog polish

**Shipped:** Updated Products page to use real client-side pagination and increased the `listProducts` fetch limit to 500 (non-destructive; no stored data changes).

### Session 2026-08-11 — Team users + section privileges A+B+C

**Goal:** Main Admin creates users from Settings and tick-marks which sections they can open.

**Shipped:**
- Migration `033_team_permissions.sql` — `profiles.permissions` jsonb + `is_active`
- Settings → **Team** tab (Admin only): table, create user, edit ticks, disable/enable, reset password, copy access
- Default new user: **Dashboard + Inbox** only
- Sidebar hides + route guard blocks unticked sections
- Admins always full access; disabled accounts signed out

**Ops:** Run `033_team_permissions.sql` in Supabase before using Team UI.

### Session 2026-08-10 — Knowledge Base A+B+C

**Goal:** EnerBot answers from real Knowledge + Products; real PDFs/photos when asked; no fake links/guesswork.

**A:** Re-index UI + stub badge · tighter `wantsReferenceImages` · APP_URL required for `/d/` photos · PDF-only download chips · `/d/` correct image filenames · no photo-hijack of product asks  
**B:** Email photo links + Meta image send · honest inspector Products grounding · Datasheets guidance · less fuzzy Storage URL rewrite  
**C:** Retrieve demotes stubs/images · collection `purpose` (`032`) · DOCX via mammoth (no OCR)

**Ops:** Run `032_knowledge_collection_purpose.sql`; Re-index Datasheets collection; confirm Render `APP_URL`.

### Session 2026-08-10 — Human Support A+B+C
- Queue excludes marketplace `status=human` spam; escalations stamp `handoff`/`handoff_reason`/`escalated_at`.
- Live sidebar waiting badge; notifications deep-link `/inbox?c=`; Working → Needs reply; wait clock from escalate.
- Desk UX: channel/preview/SLA, tabs Active/Unassigned/Mine/Team/Resolved, longest-wait default, transfer/reassign, realtime, no fake pagination.
- Files: `human-support.tsx`, `chat-api.ts`, `conversation-guards.ts`, `AppSidebar.tsx`, `notifications-api.ts`, escalate paths in WA/widget/email/meta.

### Session 2026-08-10 — Inbox WhatsApp-like A+B+C
- **A:** Inbound WA media downloaded from Meta → Supabase `knowledge` bucket; Inbox preview for image/PDF/audio/video; media sets `wa_last_customer_at` (24h window); list previews `📷/📄/🎤/🎬`.
- **B:** Multiline composer + per-conversation drafts; stamp outbound `wa_message_id` + `wa_status=sent` after Cloud API send; pin scroll after send/attach.
- **C:** Meta `statuses` (delivered/read/failed) update message ticks **only** — never bump conversation / unread / preview; day separators; Supabase Realtime on messages+conversations (poll fallback).
- Files: `whatsapp.ts`, `chat-api.ts`, `inbox.tsx`, `chat-scroll.ts`, `PROJECT_CONTEXT.md`.
- Ops: enable Realtime publication for `messages` and `conversations` in Supabase if ticks/live list feel delayed.

### Session 2026-08-10 — WhatsApp button ≠ file
- Interactive/button replies: save real button title in Inbox; never “I received your file”.
- Soft acks (“Thank you for update”, thanks) → silent. File/photo/voice ack only for real media types.
- Files: `whatsapp.ts`, `enertech-scope.ts` (`isSoftCustomerAckMessage`).

### Session 2026-08-10 — Inbox remaining UI/UX fixes
- Assigned filter = human `assignee_id` only (was matching AI labels).
- Clear draft on thread switch; optimistic unread clear; list/thread load errors + Retry.
- AI vs agent vs system bubble styles; strip `[Template:…]` from list previews; WA phone falls back to customer.phone.
- Files: `inbox.tsx`, `chat-api.ts`, `whatsapp-window.ts`.

### Session 2026-08-10 — Sales-owned requirement defer (no bot pricing)
- After `requirement_submitted` + assigned rep (name/phone), price/quote/catalogue/product asks → defer: “Okay sir — Mr. X is handling… will share price shortly.”
- Partner business auto-replies (“Thank you for contacting…”) → silent, never off-topic refuse.
- Files: `conversation-intent.ts`, `whatsapp.ts`, `widget-chat.ts`.

### Session 2026-08-10 — WhatsApp CX: stop hello_world on soft “Hii”
- After requirement/ack / “representative will contact” / human thread, soft `hi`/`ok` stays silent (no cold welcome).
- Never send Meta sample templates (`hello_world`, test/demo); greeting template only via `WHATSAPP_GREETING_TEMPLATE_NAME` or allowlisted welcome_* names.
- Re-check human ownership before AI path. Files: `conversation-intent.ts`, `whatsapp.ts`, `widget-chat.ts`.

### Session 2026-08-10 — AI Chat Support polish
- Fixed Answers Today KPI (`todayRows.length || rows.length` was wrong when today=0).
- Exact today AI count + grounded%/high-risk from today’s messages; list shows customer question before AI reply.
- Channel chips + High risk filter; error Retry; selection sync when filter/list changes.
- Files: `src/lib/ai-chat-api.ts`, `src/routes/ai-chat.tsx`.

### Session 2026-08-10 — Inbox polish (recent-on-top)
- List sorts by `last_message_at` (customer reply / any message bumps thread to top like WhatsApp); no longer primary-sort by `updated_at` (mark-as-read was reshuffling).
- Deep link `/inbox?c=` loads conversation via `getConversationById` when outside current filter/list.
- Brainmine filter chip; per-filter empty copy; smarter message auto-scroll (stick to bottom unless user scrolled up).
- Files: `src/lib/chat-api.ts`, `src/routes/inbox.tsx`.

### Session 2026-08-10 — Dashboard section polish
- Exact KPI counts (products/conversations/leads/customers/status/lead stages) — products no longer capped at 50.
- Today’s conversations: unique created-or-active today; New leads MTD exact count.
- 7-day chart labels `Mon 10` style; channel labels for IndiaMART/TradeIndia/Brainmine + count in legend.
- Recent chats click → `/inbox?c=<id>`; activity feed sorted by time; Export CSV includes channel counts; Reports toast uses router navigate.
- **Leads by Source** bar chart (exact counts per channel: Website, WhatsApp, IndiaMART, Brainmine, …).
- Files: `src/lib/dashboard-api.ts`, `src/routes/index.tsx`. Next: Inbox (or next module).

### Session 2026-08-08 — Enterprise hardening Phase 3 (CI / health / observability)
- GitHub Actions CI: migrations gate + `tsc` + build (lint warn-only for now).
- `/api/health` checks Supabase; Render `healthCheckPath` pointed at it.
- Optional Sentry via `SENTRY_DSN` / `VITE_SENTRY_DSN` (no-op if unset).
- Cron emits `cronRunId` + structured JSON logs; job errors captured.
- Docs: `supabase/MIGRATIONS.md`. Fixed pre-existing typecheck errors so CI can gate.

### Session 2026-08-08 — Enterprise hardening Phase 2 (data integrity)
- **Unique indexes:** Brainmine / IndiaMART / TradeIndia lead external ids + WA/FB/IG/email message ids (dedupe then index) — `030_phase2_integrity.sql`.
- **Cron lease:** `cron_leases` + `try_acquire_cron_lease` / `release_cron_lease`; `/api/cron/automations` skips when lease held.
- **Claim-before-act:** `claim_due_follow_up_leads`, `claim_scheduled_automation_steps`, `claim_automation_approval` wired into automation engine + daily follow-up batch.
- **RBAC:** trigger blocks client changes to `profiles.role` / `org_id`; channel `config` column revoked from Agents — Admin/Manager use `get_channel_config` / `set_channel_config`.
- **Ops:** run `030_phase2_integrity.sql` in Supabase before relying on leases/claims/unique indexes in prod.

### Session 2026-08-08 — Enterprise hardening Phase 1 (stop the bleeding)
- **Staff auth on server fns:** global `staffAuthMiddleware` (`src/start.ts`) — client sends `Authorization: Bearer`; cookie mirror `enertech_sb_access`; server `requireStaffUser()`. Widget `createServerFn`s stay public (`PUBLIC_SERVER_FN_NAMES`).
- **Meta HMAC:** WA/FB/IG POST verify `X-Hub-Signature-256` via `META_APP_SECRET` (`src/server/meta-webhook-verify.ts`). Prod rejects if secret unset.
- **Broadcast anti-double-send:** migration `029_broadcast_claim.sql` — `claim_broadcast_recipients()` (SKIP LOCKED + `sending` + stale reclaim), unique phone/email per campaign. Wired in WhatsApp + Gmail broadcast paths.
- **Fail-closed inbound:** email + IndiaMART webhooks require secrets in production.
- **Ops before deploy works fully:** run `029_broadcast_claim.sql` in Supabase (clean duplicate recipients first if unique index fails); set `META_APP_SECRET` on Render; ensure `EMAIL_INBOUND_SECRET` / IndiaMART push secret if those webhooks are used.

### Session 2026-08-08 — Broadcast sales person filter = directory dropdown
- Broadcasting lead filter **Sales person** is a dropdown from `sales_person_directory` (shows name + email; stores email). Audience match accepts lead `sales_person` as email **or** display name.

### Session 2026-08-08 — Brainmine auto sync default On / 5 min
- When Brainmine credentials exist and auto sync was never saved: default **On**, every **5 minutes** (persisted on Channels load, Configure save, and cron tick). Explicit Off still respected. UI defaults match.

### Session 2026-08-07 — Formulas load totals in kW / kVA
- Calculator totals: appliances stay in **W**; **Total load** shows **kW · kVA** (`1000 W = 1 kW`, `1 kW = 1.2 kVA`). Auto-fills `total_w` / `total_kw` / `total_kva`. Migration `028_formulas_kw_kva.sql` updates inverter seed to `total_kva * surge_factor`.

### Session 2026-08-07 — Intelligence → Formulas (Phase A)
- **New page** `/formulas` (sidebar under Intelligence): tabs **Calculator**, **Formulas**, **Load applications**.
- **DB** migration `027_sizing_formulas.sql` — tables `sizing_formulas` + `load_applications` with seeds (solar_home/industry, inverter, battery, bess, hybrid + common appliances).
- CRUD: add/edit/delete/duplicate formulas; add/edit/delete loads. Calculator picks loads (qty) → runs selected formula with `total_w` / `total_kw` auto-fill.
- **Ops:** run `027_sizing_formulas.sql` in Supabase before using the page in prod.
- Phase B later: wire library into WhatsApp/website Battery/Sales agents.

### Session 2026-08-07 — Knowledge image tags (state / place)
- **Feature:** Tag Knowledge Base images (e.g. Maharashtra) via tag icon on image cards. Stored in `knowledge_documents.metadata.tags`.
- **AI:** `findReferenceImages` boosts tag matches across any collection; when a visitor names a tagged place, only tagged hits are preferred (fallback if none).
- Re-index preserves existing tags. No new migration required.

### Session 2026-08-07 — Brainmine auto sync visibility + force due
- **Problem:** Auto lead sync On (e.g. every 3 min) but UI “Last sync” looked stuck — that field is **manual/range** `last_sync_at`, not auto. Auto only runs when Render Cron hits `/api/cron/automations` (~every 5 min) with `CRON_URL` + `CRON_SECRET`.
- **Fix:** Channels shows **Last auto sync / Next due / Last cron check / Result / Error**. **Save schedule** (On) clears due clock so next cron pulls soon. **Run auto sync now** forces the same tick. Cron attempts stamp `last_auto_sync_attempt_at` even when not due (proves cron is alive). Setup query refetches every 60s while auto is On.
- **Ops:** Confirm Render Cron `CRON_URL=https://enertechups-ai.onrender.com/api/cron/automations` and matching `CRON_SECRET` on web + cron services.

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
- **Theme:** Dark-first EnerTech navy. Light / Dark / System only — no Forest/Ocean/Sunrise/Teal/Slate palettes. Org brand hex (optional) converts to oklch and becomes the only primary.
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

1. **WordPress catalog** — run migrations `034` then `034b` in Supabase. Channels → WordPress: Inspect, paste Woo REST keys when ready, Sync now. Not deployed until asked.
2. **Follow-up Agent daily campaigns** — use Automation → “Suggest today’s follow-up”, or ensure Render cron hits `/api/cron/automations`. Approve in amber bar. Optional `FOLLOWUP_WA_TEMPLATE_NAME`.
2. **Discuss then build:** Human Support queue — latest activity on top; keep human-handled visible.
3. Confirm product image/PDF uploads / pending SQL as needed.
4. Cron: `CRON_URL` + `CRON_SECRET` on Render (every 5 min).
5. Later: DigitalOcean cutover (keep Render until DO proven); Settings RBAC.

---

### Session 2026-08-06 — Sales person directory + WA template picker

Automation: **Sales person directory** (email → display name + mobile). When lead `sales_person` is an email (e.g. `saibal@enertechups.com`), WhatsApp template variables mapped to Sales person send the directory **name** (`Mr.Saibal`). Send WhatsApp template action now uses APPROVED Meta template dropdown + auto variable rows. Migration `026_sales_person_directory.sql`. WhatsApp still sends to customer/lead phone.

---

### Session 2026-08-06 — Website chat welcome automation trigger

Added trigger **`website_visitor_captured`** (“Website chat form submitted (first time)”). Fires once when a website chatbot visitor saves contact details with a usable phone (first capture per conversation). Migration `025_website_visitor_captured_trigger.sql`. Wire automation action: Send WhatsApp template (approved welcome).

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

### Session 2026-08-07 — Brainmine WhatsApp automation after delete+sync

**Issues:** Channel=whatsapp filter blocked CRM sync (no channel); Approval queued sends; Quick Sync may not re-fetch unmodified CRM leads after Engage delete.

**Fix:** `brainmine_lead` ignores channel filter, auto-runs when Live, passes phone/name into context. Re-import after delete → use date-range pull if Quick Sync skips the lead.

---

### Session 2026-08-07 — Brainmine Requirement without query_about

**Finding:** Opportunity API often has **no** `query_about` field. Product text may live in **Items** (`item_name` / `description`) or on the linked **Lead**.

**Shipped (`ba9e1a1`):** Requirement resolve order = `query_about` → `custom_product_name` → Opportunity **items** → linked Lead. Inspect shows diagnosis, expanded Items, linked Lead, resolved preview.

**Ops:** After Render deploy → Channels → **Inspect CRM fields** → then **Sync leads now** / date pull; check Leads **Requirement**.

---

### Session 2026-08-07 — Inbox only after chatbot form submit

**Rule:** Do not put anonymous widget opens in Inbox as “Website visitor”.

**Behavior:** Conversation is created only when name + email + phone are submitted. Inbox lists those with real name/details. Empty placeholders are hidden/deleted.

---

### Session 2026-08-06 — Website welcome WA every session

**Was:** `website_visitor_captured` fired only once per conversation (`website_visitor_captured_at`).

**Now:** Sends for each website chat **session** when phone is known — first form save, return visits (new session), or same sticky session after **12h**. Remounts in the same session do not re-spam Meta.

**Note:** Opening the chatbox with no phone still cannot send WhatsApp; template goes out once contact form provides (or returns with) a number.

---

### Session 2026-08-06 — Website chats missing from Inbox

**Cause:** Inbox loaded only the latest **100** rows ordered by `last_message_at`, then filtered **Website** in the browser. Heavy WhatsApp/marketplace traffic pushed website threads out of that window — Website chip looked empty.

**Fix:** Channel / Unread / Assigned filters query Supabase directly; sort by `updated_at`; raise limit; new website sessions stamp `last_message_at` + preview so they surface immediately.

---

### Session 2026-08-06 — Website chatbot country code + welcome WA fix

**UX:** Chat contact form (`ChatWidget` + `embed`) has a compact country dial selector (default **IN +91**) beside the mobile field. Full number (`91…`) is saved to conversation / lead / customer.

**Inbox:** Form capture bumps unread + preview + system line so website visitors surface in the feed. Phone shown with `+` country code.

**Automation:** `website_visitor_captured` ignores channel filter mismatch, auto-runs when Live (no Approve queue), normalizes phone before WA template send.

**Files:** `src/lib/phone-country.ts`, `ChatWidget.tsx`, `embed.tsx`, `widget-chat.ts`, `automation-engine.ts`, `inbox.tsx`.

**Ops:** Ensure migrations `025` (+ `026` if using sales directory) are applied in Supabase.

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
| Inbox **Return to AI** | DONE — resumes EnerBot immediately for unanswered website customer messages (`conversation-handoff.ts`) |

**Paused for next session (discuss first):**
- Human Support: sort by latest message; ensure claimed/`human` chats still listed.
- Any further Inbox composer polish.

**Key files:** `src/lib/session-language.ts`, `src/lib/conversation-guards.ts`, `src/server/whatsapp.ts`, `src/server/widget-chat.ts`, `src/server/conversation-handoff.ts`, `src/routes/inbox.tsx`

**Last commits (main):** Return to AI header-only (`e32aafa`), session language (`9793dc9`), handoff UX batch.

---

### Session 2026-08-08 — Phase 4 RAG quality

**Goal:** Better answers + agent utilization via retrieval/grounding (not a rewrite).

| Item | Status |
|------|--------|
| Hybrid retrieve (wider pool, threshold 0.48, keyword boost) | DONE (`knowledge.ts`) |
| Shared `formatKnowledgeContext` + `downloadLinksFromChunks` on WA/widget/email/Meta | DONE |
| PDF text via `unpdf` (stub fallback) | DONE — **re-index existing PDFs in Knowledge UI** |
| KB-first prompts / ENGAGEMENT_LOCK | DONE (`agents.ts`, `agent-prompts.ts`) |
| Empty RAG → low confidence / high risk | DONE (`answer-inspector.ts`) |
| OpenAI chat + embeddings retries / timeouts | DONE |
| Prompt delimiters `<<<KNOWLEDGE_BASE_UNTRUSTED>>>` | DONE (`openai.ts`) |

**Ops:** Re-upload or re-index PDFs so chunks contain real text. Migrations `029`/`030` still needed in Supabase if not applied. Meta HMAC stays advisory.

**Next:** Phase 5 scale when requested; verify WhatsApp replies after deploy.

---

### Session 2026-08-08 — Intent: educate vs product dump

**Bug:** “What is solar hybrid inverter” sent product cards (“Here are the matching products”) because `wantsProductPack` treated any short product-word message as browse.

**Fix:** Informational/definition asks (EN + Hinglish: what is / kya hai / difference / explain) skip product pack unless transactional override (price, kW, dikhao/bhejo, chahiye, catalogue). AI prompts educate first, then soft CTA.

**Key file:** `src/server/product-pack.ts` (`isInformationalProductAsk`, `hasTransactionalProductSignal`).
