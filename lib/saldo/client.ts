import 'server-only'

// Saldo.ar public rates API — https://blog.saldo.com.ar/conectate-api-saldoar/
// No auth. Pattern: GET /json/rates/{from}/{to}
const SALDO_API_BASE = 'https://api.saldo.com.ar'

export interface SaldoRate {
  /** Price of the asset in `currency` (see note on bid/ask below). */
  ask: number
  bid: number
  ask_fixed_fee: number
  bid_fixed_fee: number
  currency: string
  bid_url: string
  ask_url: string
}

/** Raw rate for a `{from}/{to}` pair, keyed by the `to` system id. */
export async function fetchSaldoRate(from: string, to: string): Promise<SaldoRate> {
  const res = await fetch(`${SALDO_API_BASE}/json/rates/${from}/${to}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    throw new Error(`Saldo API ${from}/${to} failed (${res.status})`)
  }
  const data = (await res.json()) as Record<string, SaldoRate | undefined> & {
    result?: string
    message?: string
  }
  if (data.result === 'Error') {
    throw new Error(`Saldo API error: ${data.message ?? 'unknown'}`)
  }
  const rate = data[to]
  if (!rate || typeof rate.ask !== 'number') {
    throw new Error(`Saldo API returned no rate for ${from}/${to}`)
  }
  return rate
}

export interface UsdArsRate {
  /** ARS paid per 1 USD when buying USD. */
  buyUsdArs: number
  /** ARS received per 1 USD when selling USD. */
  sellUsdArs: number
  fetchedAt: string
}

/**
 * Cost of buying USD on Saldo, in ARS per USD — the rate we actually pay, so
 * the one every ARS↔USD conversion in the app uses.
 *
 * The `banco/banco_ar_usd` pair returns `currency: "ARS"`. Saldo's own
 * `bid_url` is `/a/banco/banco_ar_usd` (pesos → USD = buying USD), so `bid` is
 * the buy leg; `ask_url` runs the other way. Note `bid > ask` here, which is
 * the opposite of the usual convention — Saldo labels these from the
 * counterparty's perspective.
 */
export async function getSaldoUsdArsRate(): Promise<UsdArsRate> {
  const rate = await fetchSaldoRate('banco', 'banco_ar_usd')
  return {
    buyUsdArs: rate.bid,
    sellUsdArs: rate.ask,
    fetchedAt: new Date().toISOString(),
  }
}
