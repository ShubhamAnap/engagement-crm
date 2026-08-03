# EnerTech Engage — Agent Rules

## Project Context (READ FIRST)

**Before any work session, read [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md).**

This product is a **live** EnerTech Engage platform (Supabase + OpenAI, deploy GitHub → Render). Core modules use real data — prefer **stabilize, ops, and polish** over greenfield rewrites unless the user asks for a new feature.

Key rules:

- Prefer **one focused change** at a time; update `PROJECT_CONTEXT.md` after each session (status, decisions, session log).
- Do **not** reintroduce a `src/data/mock.ts` (or equivalent) for screens that already have live APIs.
- Stack is **TanStack Start** (not Next.js), TanStack Query, shadcn/ui, Vite.
- Dev server: `npm run dev` → http://localhost:8080/
- Prod deploy target: **GitHub → Render** (one Web Service). Database/Auth: **Supabase**.

## Branding

This product is **EnerTech Engage** for EnerTech UPS Pvt. Ltd. Do not reintroduce third-party builder branding, telemetry hooks, or marketing links.
