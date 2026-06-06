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

export interface ZelleArsRate {
  /** ARS paid per 1 USD when buying USD (pesos → Zelle). */
  buyUsdArs: number
  /** ARS received per 1 USD when selling USD (Zelle → pesos). */
  sellUsdArs: number
  fetchedAt: string
}

/**
 * Cost of buying USD via Saldo → Zelle, in ARS per USD.
 *
 * The `banco/zelle` pair returns `currency: "ARS"`. By Saldo's own URLs,
 * `bid_url` is `/a/banco/zelle` (pesos → Zelle = buying USD) and `ask_url` is
 * `/a/zelle/banco` (selling USD). So `bid` is the buy leg and `ask` is the sell
 * leg. ⚠️ Confirm against a real Saldo purchase before trusting this for cost
 * math — Saldo's field-name docs label them from the opposite perspective.
 */
export async function getZelleArsRate(): Promise<ZelleArsRate> {
  const rate = await fetchSaldoRate('banco', 'zelle')
  return {
    buyUsdArs: rate.bid,
    sellUsdArs: rate.ask,
    fetchedAt: new Date().toISOString(),
  }
}
