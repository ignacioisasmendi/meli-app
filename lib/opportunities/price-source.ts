/**
 * Where a candidate's Mercado Libre price comes from.
 *
 * There is no official way to look this up. `/sites/MLA/search` returns 403 with
 * a valid token, without a token, and even filtered to our own `seller_id`; the
 * catalog API (`/products/search`) answers but carries no price — `buy_box_winner`
 * came back absent on every product probed, and `/products/{id}/items` 404s.
 *
 * So the price is the one input that still arrives by hand, and it is isolated
 * behind this interface on purpose: everything downstream — margin, dedupe,
 * persistence, ranking — is fully automated and never learns where the number
 * came from. Swapping in a scraper or a paid API later is one new implementation
 * of `MlPriceSource` and no change anywhere else.
 */

export interface MlPrice {
  priceArs: number
  /** Units sold, when the source can see it. Never required. */
  soldQty?: number | null
  permalink?: string | null
  /** ML category, used to look up the real sale fee. */
  categoryId?: string | null
}

export interface MlPriceSource {
  readonly name: string
  /** The going price for a product, or null when it can't be established. */
  lookup(query: { title: string; brand: string; model?: string }): Promise<MlPrice | null>
}

/**
 * Prices supplied alongside the candidate — what the current manual research
 * flow already produces. Keyed on the same normalized model key the scan
 * dedupes on, so an input row and its price can be written independently.
 */
export class ManualPriceSource implements MlPriceSource {
  readonly name = 'manual'

  constructor(private readonly prices: Map<string, MlPrice>) {}

  async lookup(query: { title: string; brand: string; model?: string }): Promise<MlPrice | null> {
    const key = manualKey(query.brand, query.model ?? query.title)
    return this.prices.get(key) ?? null
  }
}

/** Normalization shared by the manual source and its callers. */
export function manualKey(brand: string, model: string): string {
  return `${brand} ${model}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
