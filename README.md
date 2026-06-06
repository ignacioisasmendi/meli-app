# Meli Inventory

Multi-account **Mercado Libre** inventory & operations platform. Replaces an Excel
workflow: centralizes products, purchases, inventory, sales, profitability and
notifications across several ML seller accounts.

Fullstack **Next.js 16** (App Router) + React 19 + TypeScript 5, Tailwind v4 +
shadcn/ui, Prisma + Postgres (Supabase), Auth0, Telegram. Server Actions + Route
Handlers talk to Postgres directly — no separate backend.

## Commands

```bash
npm run dev            # Dev server on http://localhost:3002
npm run build          # Production build
npm run start          # Serve production build
npm run lint           # eslint
npm run typecheck      # tsc --noEmit  (fast type-check)
npm run prisma:migrate # apply / create migrations (uses DIRECT_URL)
npm run prisma:studio  # browse the DB
npm run prisma:seed    # seed a demo catalog
```

## Setup

1. `cp .env.example .env.local` and fill it in (see variable list in `.env.example`).
   - `AUTH0_SECRET`: `openssl rand -hex 32`
   - `DATABASE_URL` (pooled, port 6543) + `DIRECT_URL` (direct, 5432) from Supabase.
2. `npm install`
3. `npm run prisma:migrate` then `npm run prisma:seed`
4. `npm run dev`

### Auth0
Create a Regular Web App. Allowed callback: `http://localhost:3002/auth/callback`.
Allowed logout: `http://localhost:3002`. The SDK auto-mounts `/auth/login`,
`/auth/logout`, `/auth/callback` via `middleware.ts`.

### Mercado Libre
Create an app at the ML developer portal. Set its redirect URI to `ML_REDIRECT_URI`
(`/api/mercadolibre/callback`). Configure webhooks (topics: `orders_v2`, `shipments`,
`items`, `questions`) to point at `/api/webhooks/mercadolibre`. For local webhook
testing, expose the app with a tunnel (e.g. `ngrok http 3002`).

### Cron jobs (no Redis)
Two secured route handlers, called by an external scheduler (e.g. Railway cron) with
`Authorization: Bearer $CRON_SECRET`:
- `GET /api/cron/refresh-tokens` — refresh ML tokens expiring within 1h (~every 30 min).
- `GET /api/cron/daily-summary` — send the Telegram daily summary (once/day).

## Architecture

- `app/(dashboard)/*` — feature pages (Server Components for reads).
- `actions/*` — Server Actions for writes (Zod-validated, `requireUser()` guarded).
- `app/api/*` — Route Handlers: ML OAuth, webhooks, cron, CSV exports.
- `lib/inventory/*` — stock model (FIFO batches, transactional movements) & profit calc.
- `lib/mercadolibre/*` — OAuth, API client (auto token refresh), order→sale sync.
- `lib/telegram/*` — bot client + message templates.
- `prisma/schema.prisma` — full data model.

### Stock model
`currentStock = totalPurchased − totalSold + Σ adjustments` (denormalized on Product).
`inTransit = Σ remaining of in-transit batches`. `available = currentStock − inTransit −
reserved`. Every change writes an `InventoryMovement` inside a transaction; sales consume
batches FIFO to derive USD cost of goods sold.

## Roadmap status

- **Phase 1 — done:** catalog, purchases (batches + status flow), inventory views,
  manual adjustments, Telegram (purchase / low-stock).
- **Phase 2 — done:** ML OAuth (multi-account), API client + token-refresh cron,
  webhooks → idempotent auto sales import → stock decrement → Telegram new-sale.
- **Phase 3 — done:** profitability (FIFO cost + USD/ARS setting), reports + CSV export,
  dashboard KPIs/widgets + profit-trend chart, daily-summary cron.

### Phase 4 backlog (not built — seams left in place)
- **Invoice upload** for purchases (`Purchase.invoiceUrl` exists) → Supabase Storage.
- **Barcode scanning** for receiving/adjustments.
- **WhatsApp notifications** — mirror `lib/telegram` with a `lib/whatsapp` provider.
- **Multi-warehouse** — add a `Warehouse` model + per-warehouse batch location.
- **Supplier management** — promote `Purchase.supplier` string to a `Supplier` model.
- **Forecasting / AI replenishment** — consume `InventoryMovement` history.
- **BullMQ + Redis** — move webhook processing off the request path if volume grows
  (`WebhookEvent` rows already provide a retry handle).
