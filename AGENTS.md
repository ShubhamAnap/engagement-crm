# EnerTech Engage — Agent Rules

## Project Context (READ FIRST)

**Before any work session, read [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md).**

This app is a UI prototype being converted to a fully functional enterprise platform. Key rules:

- Add real functionality **one module at a time** in phase order (foundation → features).
- **Update `PROJECT_CONTEXT.md`** after each session: module status, decisions, session log.
- Mock data lives in `src/data/mock.ts` — replace per-route as backends are built.
- Stack is **TanStack Start** (not Next.js), TanStack Query, shadcn/ui, Vite.
- Dev server: `npm run dev` → http://localhost:8080/
- Prod deploy target: **GitHub → Render** (one Web Service). Database/Auth: **Supabase**.

## Branding

This product is **EnerTech Engage** for EnerTech UPS Pvt. Ltd. Do not reintroduce third-party builder branding, telemetry hooks, or marketing links.
