# CLAUDE.md — meli-inventory

Fullstack **Next.js 16** (App Router) + React 19 + TS 5 app: multi-account Mercado
Libre inventory & operations. Server Actions + Route Handlers → Prisma/Postgres
directly (no separate backend). See `README.md` for full setup.

## Commands

```bash
npm run dev            # Dev server on :3002
npm run typecheck      # tsc --noEmit — FAST type-check, use this (not `next build`)
npm run lint           # eslint
npm run prisma:migrate # create/apply migrations
npm run prisma:seed    # demo data
```

## Setup / env (check first when something won't build)

`.env.local` is git-ignored. Required names are in `.env.example`:
`APP_BASE_URL AUTH0_* DATABASE_URL DIRECT_URL TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
ML_CLIENT_ID ML_CLIENT_SECRET ML_REDIRECT_URI CRON_SECRET USD_ARS_RATE`. A
missing-config error almost always means a missing env var, not a code bug.

## Architecture

- **`app/(dashboard)/*`** — feature pages (Server Components for reads).
- **`actions/*`** — Server Actions for writes. Always `requireUser()` + Zod-validate.
  Return `ActionResult` (`{ ok: true } | { ok: false; error }`); client shows a toast.
- **`app/api/*`** — Route Handlers: `mercadolibre/{connect,callback}`,
  `webhooks/mercadolibre`, `cron/{refresh-tokens,daily-summary}`, `reports/[type]` (CSV).
  Webhooks/cron/callback are excluded from the auth redirect in `middleware.ts`.
- **`lib/inventory/`** — `stock.ts` (the single source of truth for stock math:
  `applyPurchase`/`applySale`/`applyAdjustment`, FIFO batch consumption, transactional
  movements) and `profit.ts`. **Don't mutate Product stock counters outside these.**
- **`lib/mercadolibre/`** — `oauth.ts`, `client.ts` (per-account `mlGet` with auto token
  refresh), `sync.ts` (`processOrder` = idempotent order→sale pipeline; `syncAccountListings`).
- **`lib/telegram/`** — `client.ts` (`sendTelegramMessage`, never throws) + `messages.ts`.
- **`lib/metrics.ts`** (dashboard) and **`lib/reports.ts`** (reports + CSV) — read aggregates.

## Conventions

- Stock changes go through `lib/inventory/stock.ts` inside `prisma.$transaction`, then
  call `checkLowStock(productId)` (Telegram) and `revalidatePath`.
- Sales are idempotent on `Sale.mlOrderId`; webhooks dedupe on `WebhookEvent (topic,resource)`.
- Money: ML revenue is ARS; cost/profit are USD via `getUsdArsRate()` (Setting override or
  `USD_ARS_RATE`). Use `formatArs` / `formatUsd` from `lib/utils.ts`.
- shadcn/ui in `components/ui` (Tailwind v4, "new-york"). Match existing component patterns.

## Adding a feature

1. Server Action in `actions/<feature>.ts` (guard + validate + revalidate).
2. Page in `app/(dashboard)/<feature>/` (+ nav entry in `lib/nav.ts`).
3. Client interactivity in `components/<feature>/` ('use client').
