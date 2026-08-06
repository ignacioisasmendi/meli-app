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
  `returns.ts` unwinds a sale (cancel / open return / receive / refund-no-return); it owns
  the status + money side and calls `reverseSale` in `stock.ts` for the stock side.
- **`lib/mercadolibre/`** — `oauth.ts`, `client.ts` (per-account `mlGet` with auto token
  refresh), `sync.ts` (`processOrder` = idempotent order→sale pipeline, incl. cancellation;
  `processClaim` = returns/refunds; `syncAccountListings`).
- **`lib/telegram/`** — `client.ts` (`sendTelegramMessage`, never throws) + `messages.ts`.
- **`lib/imports/`** — `amazon-order.ts` (types + total reconciliation, dependency-free),
  `amazon-screenshot.ts` (Claude vision extraction, server only), `match-product.ts`.
- **`lib/purchases.ts`** — read side of purchases, grouped by `PurchaseOrder` (the
  supplier order) rather than by line.
- **`lib/metrics.ts`** (dashboard) and **`lib/reports.ts`** (reports + CSV) — read aggregates.

## Conventions

- Stock changes go through `lib/inventory/stock.ts` inside `prisma.$transaction`, then
  call `checkLowStock(productId)` (Telegram) and `revalidatePath`.
- A batch is only sellable once it reaches `WAREHOUSE`/`AVAILABLE`, which is exactly when
  `costShipment` puts it there — so freight is known before FIFO can consume it and
  provisional costs never reach a sale.
- Sales are idempotent on `Sale.mlOrderId`; webhooks dedupe on `WebhookEvent.dedupeKey`
  (`topic|resource|sent`) — NOT on `(topic, resource)`, since ML re-notifies the same
  resource on every state change and an order's cancellation would be swallowed.
- A reversed sale keeps its gross figures; `refundedArs` / `reversedProfitUsd` sit beside
  them so every aggregate can net out with `SUM(gross) - SUM(reversed)` in one query. Use
  `netRevenueArs` / `netProfitUsd` from `lib/inventory/returns.ts` for per-row reads.
- Returned goods only re-enter stock at `receiveReturn` (physical receipt), never when the
  claim opens — otherwise units still in the mail would look sellable.
- Money: ML revenue is ARS; cost/profit are USD via `getUsdArsRate()` — the Saldo
  `banco/banco_ar_usd` **bid** (what we pay to buy USD), cached once per Argentina day,
  falling back to the `usdArsRate` Setting then `USD_ARS_RATE`. Use `formatArs` /
  `formatUsd` from `lib/utils.ts`.
- Peso costs that feed a stored USD figure (e.g. a shipment's local delivery) must store
  the rate used alongside the amount, so re-costing later can't move booked landed costs.
- An import groups its lines under a `PurchaseOrder`, which stores the supplier's tax +
  shipping. A line's share of them is `totalCostUsd - unitPriceUsd * quantity` — read it,
  never re-split the header, or re-importing into the same order would move booked costs.
- shadcn/ui in `components/ui` (Tailwind v4, "new-york"). Match existing component patterns.

## Adding a feature

1. Server Action in `actions/<feature>.ts` (guard + validate + revalidate).
2. Page in `app/(dashboard)/<feature>/` (+ nav entry in `lib/nav.ts`).
3. Client interactivity in `components/<feature>/` ('use client').
