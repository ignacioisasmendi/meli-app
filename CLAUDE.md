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
ML_CLIENT_ID ML_CLIENT_SECRET ML_REDIRECT_URI CRON_SECRET USD_ARS_RATE
ANTHROPIC_API_KEY`. A
missing-config error almost always means a missing env var, not a code bug.

## Architecture

- **`app/(dashboard)/*`** — feature pages (Server Components for reads).
- **`actions/*`** — Server Actions for writes. Always `requireUser()` + Zod-validate.
  Return `ActionResult` (`{ ok: true } | { ok: false; error }`); client shows a toast.
- **`app/api/*`** — Route Handlers: `mercadolibre/{connect,callback}`,
  `webhooks/mercadolibre`, `cron/{refresh-tokens,daily-summary}`, `reports/[type]` (CSV),
  `imports/parse-screenshot` (Claude vision → draft purchase lines; see `docs/amazon-import.md`).
  Webhooks/cron/callback are excluded from the auth redirect in `middleware.ts`.
- **`lib/inventory/`** — `stock.ts` (the single source of truth for stock math:
  `applyPurchase`/`applySale`/`applyAdjustment`, FIFO batch consumption, transactional
  movements) and `profit.ts`. **Don't mutate Product stock counters outside these.**
  Cost arrives in two stages: `landed.ts` allocates the supplier's own tax/shipping at
  purchase time, then `shipment.ts` (pure allocation) + `shipment-costing.ts` (the DB
  half) spread the USA→Argentina courier bill across a `Shipment`'s batches on arrival.
  A batch stores `goodsUnitCostUsd + freightUnitCostUsd = unitCostUsd`; only
  `unitCostUsd` feeds FIFO and profit.
- **`lib/mercadolibre/`** — `oauth.ts`, `client.ts` (per-account `mlGet` with auto token
  refresh), `sync.ts` (`processOrder` = idempotent order→sale pipeline; `syncAccountListings`).
- **`lib/telegram/`** — `client.ts` (`sendTelegramMessage`, never throws) + `messages.ts`.
- **`lib/imports/`** — `amazon-order.ts` (types + total reconciliation, dependency-free),
  `amazon-screenshot.ts` (Claude vision extraction, server only), `match-product.ts`.
- **`lib/metrics.ts`** (dashboard) and **`lib/reports.ts`** (reports + CSV) — read aggregates.

## Conventions

- Stock changes go through `lib/inventory/stock.ts` inside `prisma.$transaction`, then
  call `checkLowStock(productId)` (Telegram) and `revalidatePath`.
- A batch is only sellable once it reaches `WAREHOUSE`/`AVAILABLE`, which is exactly when
  `costShipment` puts it there — so freight is known before FIFO can consume it and
  provisional costs never reach a sale.
- Sales are idempotent on `Sale.mlOrderId`; webhooks dedupe on `WebhookEvent (topic,resource)`.
- Money: ML revenue is ARS; cost/profit are USD via `getUsdArsRate()` (Setting override or
  `USD_ARS_RATE`). Use `formatArs` / `formatUsd` from `lib/utils.ts`.
- shadcn/ui in `components/ui` (Tailwind v4, "new-york"). Match existing component patterns.

## Adding a feature

1. Server Action in `actions/<feature>.ts` (guard + validate + revalidate).
2. Page in `app/(dashboard)/<feature>/` (+ nav entry in `lib/nav.ts`).
3. Client interactivity in `components/<feature>/` ('use client').
