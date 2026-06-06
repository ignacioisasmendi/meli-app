# Roadmap: replace the "SHOP TANDIL" Excel

Goal: make this app the single source of truth for stock, sales, cost, profit,
monthly summaries, purchases and product lifecycle — replacing the
`SHOP TANDIL - TEMPORADA 2` spreadsheet.

Arrival updates are **manual for now** (no Amazon/Gmail integration — see Phase 6).

---

## How the Excel actually works

Each row = **one physical unit** moving through a pipeline, with two dates and a status:

- `Fecha (compra)` → `Fecha (En Depo)` — bought, then **arrived at depot**
- `Estado`: `RECIBIDO` → `YENDO A DEP` → `YENDO FULL`/`EN FULL` → `VENDIDO`,
  plus `NACHO` (personal), `INCONVENIENTE`/`RARO` (problems), `DEVUELTO` (returned)
- **Cost = `Precio unitario` + `Envio` = `Costo total`** (product + per-unit freight, *no tax*)
- **Sale**: `Venta ARS` ÷ `Valor dolar del dia` = `Venta USD`;
  `Venta USD − Costo total` = `Ganancia USD`; margin = profit ÷ revenue
- Side tables: **monthly summary** (qty, volume, profit, margin),
  **stock by product** (total / sold), **cash accounts** (Patrimonio, Caja USA, Caja MP),
  channel notes (`CTA NACHO`, `FEDE`, `IVI`)

## What the app already covers

- Products + stock counters, FIFO batches
- ML revenue in ARS with USD cost/profit
- Multi-account, dashboard metrics, CSV reports, Telegram alerts
- Manual purchase import

---

## Key design decision: units vs batches

The sheet is **one row per unit**. The app is **batches + counters**.

- **A. Batch-based with splitting (recommended).** A purchase of 10 can split into
  sub-batches as units change state/location (e.g. 3 `EN FULL`, 5 `DEPOT`, 2 `SOLD`).
  Reproduces every number/view without 1 row per unit; fits the current FIFO/profit engine.
- **B. True per-unit rows.** Mirrors the Excel exactly but heavier (5,000+ rows/season, heavier UI).

**Plan below assumes A. (Decision pending confirmation.)**

## Status mapping (Excel → app)

| Excel `Estado` | App status / location |
|---|---|
| (compra) | `PURCHASED` |
| `RECIBIDO` | `IN_USA` (arrived at forwarder) |
| `YENDO A DEP` | `IN_TRANSIT` |
| (en depo) | `DEPOT` |
| `YENDO FULL` / `EN FULL` | location = `ML_FULL` |
| `VENDIDO` | `SOLD` (via sale) |
| `NACHO` | `PERSONAL` (withdrawn, not sold) |
| `INCONVENIENTE` / `RARO` | `ISSUE` |
| `DEVUELTO` | `RETURNED` |

---

## Phases

### Phase 0 — Data model foundations
One Prisma migration (`prisma/schema.prisma`):
- **Batch**: add `arrivedAt` (depot date), `freightUsdPerUnit`, `location`
  (USA / IN_TRANSIT / DEPOT / ML_FULL). Landed cost = `unitCostUsd + freightUsdPerUnit`.
- **Status enum**: add `PERSONAL`, `ISSUE`, `RETURNED` (+ the location field above for Full).
- **Sale**: add `usdArsRateAtSale` so historical profit never shifts with today's rate.
- Channel tag on purchase/sale (main vs `CTA NACHO`).

### Phase 1 — Cost model + lifecycle (daily workflow) ⭐ highest value
- Purchases capture **price + per-unit freight** → landed cost (replaces tax-based import).
- A **status/location board** to move units between states (split quantities),
  set arrival date on receipt — this is the manual "it arrived" action.
- Inventory grouped by **product × location** (Depot / Full / In USA / Sold).

### Phase 2 — Sales & profit fidelity
- Capture the **day's USD rate per sale**; profit = `Venta USD − landed (FIFO)`.
- Make ML auto-sync and manual sales both write this consistently.

### Phase 3 — Reporting (right side of the sheet)
- **Monthly P&L**: units sold, volume USD, profit USD, margin % per month.
- **Stock-by-product** table: total / in Full / in depot / sold.

### Phase 4 — One-time history import
- Parser for the `SHOP TANDIL - TEMPORADA 2` CSV → products, purchases
  (freight + both dates), sales (with daily rate).
- Normalize/flag the file's human inconsistencies (some `Costo total` rows ignore
  `Envio`; a couple of 2025/2026 date typos) for manual fixup.

### Phase 5 — Optional accounting
- **Treasury**: Patrimonio, Caja USA, Caja MP balances + movements.
  Real bookkeeping beyond inventory — separate module, build only if wanted in-app.

### Phase 6 — Deferred (manual for now)
- Amazon/forwarder arrival automation. No buyer API exists (Amazon SP-API is
  seller-only); the realistic path is **Gmail parsing of Amazon "delivered to your
  US address" emails** to auto-flip `IN_USA`. Depot arrival in Argentina is the
  forwarder's event (manual unless they expose tracking). Documented, not scheduled.

---

## Suggested sequence

`0 → 1 → 2 → 3` makes the app a full daily replacement. `4` loads real history.
`5`/`6` are optional add-ons.

Rough effort: Phase 0 small; Phase 1 medium-large (board + splitting is the bulk);
Phases 2–3 medium; Phase 4 medium; Phase 5 large; Phase 6 large.

## Open questions
1. Units vs batches — confirm **A (batch + splitting)** vs **B (per-unit rows)**.
2. Start point: begin with Phase 0 + 1 once the modeling decision is confirmed.
