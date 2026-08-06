/**
 * The real Mercado Libre sale fee, from ML's own pricing endpoint.
 *
 * `/sites/MLA/listing_prices` is authenticated (it 403s without a token) but
 * needs no special permissions, unlike `/sites/MLA/search`, which is closed
 * outright. Measured on 2026-08-06 for a Clásica listing:
 *
 *   category MLA1051 / MLA1000 / MLA1276 → 16%
 *   category MLA1672                     → 15.5%
 *   fixed_fee                            → 0 at 80k / 250k / 800k ARS
 *
 * A Premium (`gold_pro`) listing was 25.3% on the same probe — nine points of
 * margin that a flat "16%" assumption would silently invent.
 *
 * Deliberately takes an access token rather than an account: `mlGet` lives
 * behind `server-only`, and this has to stay callable from a plain tsx script.
 */

const ML_API_BASE = 'https://api.mercadolibre.com'

/** Clásica. The listing type this business actually publishes on. */
export const LISTING_TYPE_CLASICA = 'gold_special'

/** Used when ML can't be reached — the modal rate across categories. */
export const DEFAULT_FEE_RATE = 0.16

export interface SaleFee {
  /** Commission as a fraction of the sale price, e.g. `0.16`. */
  rate: number
  /** Commission in ARS at the probed price. */
  feeArs: number
  /** ML's fixed per-sale charge in ARS. Zero above the low-price threshold. */
  fixedFeeArs: number
  /** False when the figures are the fallback rather than ML's answer. */
  fromApi: boolean
}

interface ListingPriceRow {
  listing_type_id?: string
  sale_fee_amount?: number
  sale_fee_details?: {
    percentage_fee?: number
    fixed_fee?: number
    gross_amount?: number
  }
}

/**
 * Fees are a step function of price within a category, so caching on the
 * category alone would be wrong at the edges. Bucketing to 10k ARS keeps the
 * call count down over a scan of hundreds of candidates without crossing a step.
 */
const cache = new Map<string, SaleFee>()

const bucket = (priceArs: number) => Math.round(priceArs / 10_000) * 10_000

/** Sale fee for a price/category, falling back to a flat rate if ML is down. */
export async function getSaleFee(
  accessToken: string,
  priceArs: number,
  categoryId?: string | null
): Promise<SaleFee> {
  const price = Math.max(0, Math.round(priceArs))
  const key = `${categoryId ?? '-'}|${bucket(price)}`
  const hit = cache.get(key)
  if (hit) return hit

  const fallback: SaleFee = {
    rate: DEFAULT_FEE_RATE,
    feeArs: Math.round(price * DEFAULT_FEE_RATE),
    fixedFeeArs: 0,
    fromApi: false,
  }

  const params = new URLSearchParams({
    price: String(price),
    listing_type_id: LISTING_TYPE_CLASICA,
  })
  if (categoryId) params.set('category_id', categoryId)

  try {
    const res = await fetch(`${ML_API_BASE}/sites/MLA/listing_prices?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
    if (!res.ok) return fallback

    const body = (await res.json()) as ListingPriceRow | ListingPriceRow[]
    const rows = Array.isArray(body) ? body : [body]
    const row =
      rows.find((r) => r.listing_type_id === LISTING_TYPE_CLASICA) ?? rows[0]
    if (!row || typeof row.sale_fee_amount !== 'number') return fallback

    // Prefer the explicit percentage; derive it only if ML omits it.
    const pct = row.sale_fee_details?.percentage_fee
    const rate =
      typeof pct === 'number' && pct > 0
        ? pct / 100
        : price > 0
          ? row.sale_fee_amount / price
          : DEFAULT_FEE_RATE

    const fee: SaleFee = {
      rate,
      feeArs: Math.round(row.sale_fee_amount),
      fixedFeeArs: Math.round(row.sale_fee_details?.fixed_fee ?? 0),
      fromApi: true,
    }
    cache.set(key, fee)
    return fee
  } catch {
    return fallback
  }
}
