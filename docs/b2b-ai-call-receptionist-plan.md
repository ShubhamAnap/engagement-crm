# B2B AI Call Receptionist — Complete Business & Delivery Plan

> **Separate product from Engage CRM.** Equal.ai-style value (AI answers, knows who/why, live transcript, takeover, summary) delivered as a **business virtual-number receptionist**, not a consumer phone-screening app.
>
> **Status:** Planning only — do not implement in the Engage repo.
> **Date:** 2026-08-21  
> **Working name (placeholder):** *Engage Voice* / *Call Desk AI* (pick brand later)

---

## 1. Product definition

### One-liner
A virtual Indian phone number that answers inbound business calls with AI, shows the team a live transcript and caller intent, lets a human take over, and stores a searchable call summary on the lead/CRM.

### Who buys it
| Segment | Example | Pain |
|--------|---------|------|
| SMB sales / support | UPS dealers, clinics, agencies | Missed calls after hours / lunch |
| Founders / field teams | 1–5 person shops | Can’t pick every enquiry call |
| Mid-market contact centers | 10–50 agents | Overflow / after-hours coverage |

### What we are **not** building (v1)
- Equal-style answer on the user’s personal SIM  
- Consumer spam-blocking app  
- Full dialer / ACD replacement  
- Outbound cold-call campaigns (phase 2+)

### Core Equal-like features (B2B mapping)

| Equal consumer feature | Our B2B equivalent |
|------------------------|--------------------|
| AI picks up | AI answers Exotel/Twilio virtual number |
| Live transcript | Web dashboard + optional mobile PWA |
| Who & why | Intent one-liner + structured fields (name, company, reason) |
| Takeover | Soft transfer to agent mobile / SIP / Engage Inbox later |
| Ask to reschedule / prompts | Mid-call quick actions from dashboard |
| Call summary + recording | Stored per call; CRM/webhook export |

---

## 2. Architecture (B2B)

```
Caller (PSTN)
    │
    ▼
Exotel / Twilio (India DID)
    │  media + webhooks
    ▼
Voice Orchestrator (your backend)
    ├── STT streaming  (Deepgram / Sarvam)
    ├── Dialog brain   (LLM + scripts + tools)
    ├── TTS streaming  (Sarvam / ElevenLabs / Deepgram Aura)
    ├── Session store  (Postgres)
    ├── Recording      (S3/R2)
    └── Realtime fanout (WebSocket → dashboard)
            │
            ▼
Admin / Agent UI (web)
  live transcript · intent · takeover · history
```

### Suggested stack (greenfield repo)

| Layer | Choice | Why |
|-------|--------|-----|
| Backend | Node (Fastify) or Go | WebSocket + webhook friendly |
| DB | Postgres (Supabase or RDS) | Calls, orgs, billing meters |
| Object storage | Cloudflare R2 / S3 | Recordings |
| Telephony | **Exotel** first (India KYC, DIDs) | Local compliance; Twilio as alt |
| STT | Deepgram Flux/Nova **or Sarvam** (Hindi) | Latency + Indic languages |
| TTS | Sarvam Bulbul / Deepgram Aura / Eleven Flash | Cost vs quality |
| LLM | GPT-4.1-mini / Gemini Flash | Dialog + summary |
| Frontend | React + Vite | Live call console |
| Auth | Email + OTP; org workspaces | Multi-tenant SaaS |
| Billing | Razorpay subscriptions + metered overage | Same motion as Engage |

Engage CRM integration = **optional Phase 2 webhook / OAuth**, not a hard dependency for v1.

---

## 3. Delivery roadmap

### Phase 0 — Foundations (2 weeks)
- Company entity, brand, privacy + recording consent copy  
- Exotel account + KYC + 1 test DID  
- Repo, CI, staging, secrets  
- Legal: TRAI/DND awareness, “call may be recorded” prompt  

**Exit:** Test number rings → webhook received.

### Phase 1 — MVP (6–8 weeks)
Must ship:
1. Inbound answer with greeting + recording disclosure  
2. AI asks name + reason; collects phone if withheld  
3. Live transcript on web console  
4. Intent one-liner (“Sales enquiry – 10kVA UPS”)  
5. Agent **takeover** (bridge to agent mobile)  
6. End-of-call summary + recording link  
7. Org signup, seats, API keys for webhook  
8. Basic call log search  

**Exit:** 5 design-partner businesses taking real calls for 2 weeks.

### Phase 2 — Productize (6 weeks)
- Mid-call quick actions (reschedule, take message, transfer dept)  
- Business hours / after-hours scripts  
- Hindi + English (auto-detect)  
- CRM webhooks (Engage, Zoho, HubSpot, Google Sheet)  
- Usage dashboard + overage alerts  
- Concurrent call limits per plan  

### Phase 3 — Scale (8+ weeks)
- Warm transfer to queue / SIP  
- Outbound callback AI  
- Voice cloning / branded voice (enterprise)  
- Analytics (conversion, drop-off, sentiment)  
- Mobile PWA for field takeover  
- SLA / dedicated numbers / SSO  

---

## 4. Unit economics (cost per answered minute)

All figures are **indicative mid-2026 India B2B** planning numbers (ex-GST unless noted). Negotiate Exotel; AI vendors change often — rebuild the model quarterly.

### 4.1 Variable cost stack (inbound, India)

| Component | Low (₹/min) | Typical (₹/min) | Notes |
|-----------|-------------|----------------|-------|
| Telephony inbound (Exotel) | 0.30 | **0.40** | Per-pulse; plan dependent |
| STT streaming | 0.40 | **0.55** | ~$0.005–0.007/min; Sarvam may differ |
| LLM dialog | 0.05 | **0.15** | Flash/mini; spikes with long context |
| TTS | 0.40 | **0.70** | Dominant AI cost if “premium” voice |
| Recording storage (amortized) | 0.02 | **0.05** | ~MB/min + retention |
| **Total COGS / min** | **~1.2** | **~1.85** | Round to **₹2.0** planning buffer |

**Rule of thumb for pitching:** plan COGS at **₹2.0 per connected minute**, then add margin.

Alternative: **Gemini Live / OpenAI Realtime** (speech-to-speech) often lands **₹1.5–3.5/min AI-only** before telephony — test both; pipeline STT→LLM→TTS is easier to control for Hindi + tools.

### 4.2 Fixed monthly platform cost (your company, early stage)

| Item | Monthly (₹) | Notes |
|------|-------------|-------|
| Cloud (app + DB + Redis) | 8,000–25,000 | Scales with concurrent calls |
| Object storage + bandwidth | 2,000–10,000 | Recordings |
| Exotel number rentals (inventory) | 500–2,000 / DID | Pass through or include |
| Monitoring / error tracking | 2,000–5,000 | |
| Email / SMS OTP | 1,000–5,000 | |
| **Base burn (infra only)** | **~15k–45k** | Before salaries |

### 4.3 Worked examples (your cost, not price)

Assume avg answered call = **2.5 minutes**, answer rate on DID traffic = product-dependent.

| Monthly answered minutes | COGS @ ₹2/min | + 10 DIDs rental ~₹10k | Rough variable+numbers |
|--------------------------|---------------|------------------------|-------------------------|
| 1,000 | ₹2,000 | ₹12,000 | Tiny pilot |
| 10,000 | ₹20,000 | ₹30,000 | Early SMB book |
| 50,000 | ₹1,00,000 | ₹1,10,000 | Growing |
| 2,00,000 | ₹4,00,000 | ₹4,20,000 | Need volume Exotel rates |

---

## 5. Pricing (what you charge)

Goal: **gross margin ≥ 60%** on minutes after telephony pass-through clarity.

### Recommended SaaS packs (INR, ex-GST)

| Plan | Price / mo | Included minutes | Seats | Concurrent calls | Overage |
|------|------------|------------------|-------|------------------|---------|
| **Starter** | ₹4,999 | 1,000 | 3 | 2 | ₹4.5 / min |
| **Growth** | ₹14,999 | 5,000 | 10 | 5 | ₹3.5 / min |
| **Business** | ₹39,999 | 20,000 | 25 | 15 | ₹2.8 / min |
| **Enterprise** | Custom | Commit | SSO / SLA | Custom | Negotiated |

Optional add-ons:
- Extra DID: ₹499–999 / mo  
- Hindi+ premium voice: +₹2,000 / mo  
- CRM connector pack: +₹1,999 / mo  
- Recording retention > 90 days: +₹0.02 / min stored-month  

### Margin check (Growth example)

- Revenue: ₹14,999  
- Included 5,000 min COGS @ ₹2: ₹10,000  
- Gross on included: ~₹5,000 (**~33%**) — tight  

**Fix for healthy margin:** either  
1. Raise Growth to **₹19,999**, or  
2. Include only **3,500 min** at ₹14,999, or  
3. Drive Exotel+AI blended COGS toward **₹1.4–1.6/min** (Sarvam, Flash TTS, volume rates).

**Target healthy pack:** price so included minutes cost you ≤ **40% of MRR**.

Example revised Growth: **₹19,999 / 5,000 min** → COGS ₹10k → gross **~50%** before support; overage at ₹3.5 still profitable vs ₹2 COGS.

### Per-seat vs per-minute
- Charge **platform fee + minutes** (above).  
- Do **not** only charge per seat — voice COGS is minute-driven.

---

## 6. Go-to-market

### Beachhead
1. Existing Engage CRM customers (upsell voice DID)  
2. IndiaMART / TradeIndia heavy SMBs who already miss phone leads  
3. Clinics, education counselors, solar/UPS dealers  

### Motion
- 14-day pilot: 1 DID + 500 min free or ₹1  
- Setup workshop: script + business hours + takeover numbers  
- Case study: “missed-call → booked demo %”

### Success metrics (pilot)
- ≥ 70% calls get usable “reason” field  
- Median takeover connect < 20s  
- < 8% caller hangup before first AI sentence  
- NPS / “would pay” from 5 pilots  

---

## 7. Team & build budget (India, INR)

### MVP team (Phase 0–1, ~3 months)

| Role | Time | Cost / mo (loaded, indie) | Notes |
|------|------|---------------------------|-------|
| Backend / voice eng | 1 FTE | 1.5–3.0 L | Orchestrator critical |
| Frontend | 0.5–1 FTE | 0.8–2.0 L | Live console |
| Android **not required** for B2B v1 | — | — | Web + PWA enough |
| Product / founder | part | — | Scripts, pilots |
| Part-time DevOps | 0.25 | 0.3–0.6 L | |

**3-month build cash (salaries only):** ~₹8–18 L depending on hiring bar.  
**+ vendors / Exotel credits / tools:** ₹1–3 L.

### First-year opex sketch (lean)

| Category | Year 1 (₹) |
|----------|------------|
| Core eng (2–3 people avg) | 40–80 L |
| Infra + AI + telephony (cogs grow with sales) | 10–40 L |
| Legal / CA / compliance | 2–5 L |
| Marketing / pilots | 5–15 L |
| **Total lean** | **~60–140 L** |

Raise or bootstrap against Engage cash-flow; keep **legal entity / brand** separable if you may fundraise on Voice alone.

---

## 8. Compliance & risk (India)

| Topic | Action |
|-------|--------|
| Recording | Play consent line in first 5s; store consent flag |
| DND / promotional | Product is **inbound service**, not promo dialer — still document use |
| KYC | Exotel/Twilio KYC for each business DID |
| Data | Retention policy (30/90/365); delete on customer request |
| Spam / fraud | Rate limits; blocklists; abuse monitoring |
| Liability | AI mis-promises → script guardrails (“no price commitment”) |

---

## 9. Competitive positioning

| Player | Position | Our wedge |
|--------|----------|-----------|
| Equal AI | Consumer personal SIM | We sell **business DID + CRM workflow** |
| Exotel/Twilio native AI | Infrastructure | We sell **finished receptionist UX + pricing** |
| International voice agents (Retell, Vapi) | Dev tools / US-first | India DID, Hindi, INR billing, SMB setup |
| Human BPOs | People | 24×7 cheaper overflow, not full replacement |

Positioning line:  
**“Never miss a business call — AI answers, your team sees why, takeover when it matters.”**

---

## 10. Financial model snapshot (illustrative)

Assumptions (aggressive-but-plausible Year 1):
- Month 6: 40 Growth accounts × ₹19,999 ≈ **₹8 L MRR**  
- Blended COGS 45% of revenue early → improving with volume  
- Churn 4% monthly until onboarding matures  

**Break-even:** often **80–150 paying orgs** on Growth-like ARPU for a 2–3 eng team — validate with your salary reality.

Build a spreadsheet with:
- `minutes_answered`  
- `cogs_per_min`  
- `mrr`  
- `gross_margin`  
- `cac` / `payback`  

---

## 11. Decision checklist (before writing code)

1. Brand & entity separate from Engage? (recommended)  
2. Exotel vs Twilio India as primary? (**Exotel default**)  
3. Hindi required day-1 or English-only MVP?  
4. Takeover = PSTN bridge only, or SIP too?  
5. Engage integration Phase 1 or 2?  
6. Target gross margin on included minutes ≥ 50%?  

---

## 12. 90-day execution checklist

**Days 1–14**  
- [ ] Exotel KYC + test DID  
- [ ] Consent script + privacy draft  
- [ ] Repo + hello-world inbound webhook  
- [ ] Cost spreadsheet locked (COGS ₹/min)  

**Days 15–45**  
- [ ] STT→LLM→TTS loop on live calls  
- [ ] Live transcript WebSocket UI  
- [ ] Summary + recording storage  
- [ ] 3 internal dogfood scripts  

**Days 46–75**  
- [ ] Takeover to mobile  
- [ ] Multi-tenant orgs + Razorpay  
- [ ] 5 paid/design pilots  

**Days 76–90**  
- [ ] Pricing live  
- [ ] Onboarding runbook  
- [ ] Kill/continue decision on COGS and hangup rate  

---

## 13. Bottom line

| Question | Answer |
|----------|--------|
| Can we build Equal for business? | **Yes**, via virtual numbers — not personal SIM. |
| Hardest tech? | Low-latency voice loop + reliable takeover. |
| Hardest business? | Unit economics (TTS + telco) and trust. |
| Sensible COGS target | **≤ ₹2 / connected min** (plan), improve to **₹1.5**. |
| Sensible price start | **₹5k–20k/mo packs** with metered overage. |
| Time to pilot | **~8–10 weeks** with focused team. |
| Relation to Engage | Upsell channel later; **separate codebase**. |

---

---

## 14. Founder / solo-developer cost to go live (YOUR money)

This section answers: **“Main developer hoon — live tak kitna kharch mera hoga?”**  
Customer pricing alag hai. Yahan sirf **tumhara pocket / company burn** hai.

Assumptions: tum **khud code** karte ho (salary = ₹0). Hire nahi. India, INR, ex-GST unless noted.

### A) One-time setup (Month 0)

| Item | Low | Realistic | Notes |
|------|-----|-----------|-------|
| Domain + DNS | ₹800 | ₹1,500 | `.in` / `.com` 1 year |
| Logo / basic landing (DIY) | ₹0 | ₹3,000 | Canva / Cursor |
| Exotel KYC + first DID setup | ₹0–2,000 | ₹3,000–8,000 | Prepaid credits + number rental advance |
| SSL / hosting bootstrap | ₹0 | ₹0 | Render/Fly free tier or existing |
| Apple/Play | ₹0 | ₹0 | B2B web — no app store needed |
| Legal templates (DIY + CA glance) | ₹2,000 | ₹10,000 | Privacy, ToS, recording consent |
| **One-time total** | **~₹3,000** | **~₹15,000–25,000** | |

### B) Monthly burn WHILE building MVP (2–3 months)

| Item | Low / mo | Comfortable / mo | Notes |
|------|----------|------------------|-------|
| Cloud (Render / Railway / Fly + Postgres) | ₹0–1,500 | ₹3,000–8,000 | Start free/hobby; paid when WebSockets + DB |
| Object storage (R2/S3) | ₹0–200 | ₹500–1,000 | Recordings small at first |
| Exotel prepaid credits (test calls) | ₹1,000 | ₹3,000–5,000 | Dogfood + demo calls |
| DID rental | ₹300–800 | ₹500–1,500 | 1–2 numbers |
| OpenAI / Gemini API | ₹500 | ₹2,000–5,000 | Dev + demos |
| STT (Deepgram/Sarvam) | ₹500 | ₹2,000–4,000 | Streaming tests add up |
| TTS | ₹500 | ₹2,000–5,000 | Often biggest AI bill in tests |
| Monitoring (Sentry free→paid) | ₹0 | ₹0–2,000 | |
| Cursor / tools / GitHub | ₹0–2,000 | ₹2,000 | If not already paying |
| **Monthly while building** | **~₹3,000** | **~₹15,000–25,000** | |

**2.5 months build @ comfortable:** ≈ **₹40,000–65,000** variable + one-time.

### C) “Live” soft-launch burn (first customers / pilots)

Assume: 3–5 pilot orgs, **2,000–5,000 answered minutes / month** total.

| Item | @ 2,000 min | @ 5,000 min |
|------|-------------|-------------|
| COGS (~₹2/min all-in) | ₹4,000 | ₹10,000 |
| DIDs (3–5 numbers) | ₹2,000–5,000 | ₹2,000–5,000 |
| Cloud (always-on voice + WS) | ₹5,000–12,000 | ₹8,000–20,000 |
| AI overage buffer | ₹2,000 | ₹5,000 |
| **Your monthly burn (no salary)** | **~₹13k–25k** | **~₹25k–40k** |

Agar pilots **paid** hain (even ₹5k each × 4 = ₹20k MRR), soft-launch nearly **self-pays**. Agar free pilots → ye burn **tumhare pocket** se.

### D) Three realistic paths for YOU

#### Path 1 — Ultra lean solo (recommended start)
- Tum code; no hire  
- 1 Exotel DID; English-first; cheap TTS  
- Host on cheap Render + Supabase free/pro  

| Period | Your cash out |
|--------|----------------|
| Setup | ₹5,000–15,000 |
| Build 10 weeks | ₹25,000–50,000 |
| First 3 months live (low traffic) | ₹40,000–80,000 |
| **Total to “real live + pilots”** | **≈ ₹70,000 – ₹1.5 lakh** |

#### Path 2 — Comfortable solo (better voice quality, less stress)
- Paid Deepgram + nicer TTS  
- Staging + prod  
- Extra test minutes  

| Total 4–5 months | **≈ ₹1.5 – 3 lakh** |

#### Path 3 — Solo + 1 contract voice eng (faster)
- Extra eng ₹1.5–3L / month × 2–3 months  

| Total | **≈ ₹5 – 12 lakh** | Only if time > money |

### E) What you do NOT need to pay day-1
- Android developer  
- Office  
- Heavy ads  
- Enterprise Exotel commit  
- Equal-scale language pack (start EN + basic HI)

### F) Cash you should KEEP in hand (buffer)
Besides build spend, keep **₹50,000–1,00,000** liquid for:
- Sudden API bill spike (TTS loops in bug)  
- Exotel KYC delays / recharges  
- 1 month cloud if a pilot floods minutes  

**Safe founder reserve to start:** **₹2–3 lakh** in account if Path 1–2 (covers build + 3 months live + buffer).  
**Absolute minimum risk Path 1:** **~₹1 lakh** carefully managed.

### G) Week-by-week spend control (so bill na phate)

1. Cap OpenAI/Deepgram/ElevenLabs at **$50–100/mo** until first pilot  
2. Exotel: only **prepaid**, auto-recharge OFF  
3. Kill staging overnight if idle  
4. Record only when `NODE_ENV=production` + consented  
5. Log **₹ per call** from day 1 (duration × rates)

### H) One-line answer

| Question | Answer |
|----------|--------|
| Minimum to MVP live (solo, lean) | **~₹70k–1.5L** over ~3 months |
| Comfortable solo | **~₹1.5–3L** |
| With hired help | **₹5L+** |
| Monthly after live (few pilots, you code) | **~₹15k–40k** until revenue covers |

Engage CRM se alag rakho billing/accounts — is product ka burn voice minutes pe chadhta hai, text CRM se alag.
