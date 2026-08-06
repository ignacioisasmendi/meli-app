/**
 * Opportunity margin: what one Amazon-sourced unit actually leaves behind after
 * it is flown in and sold on Mercado Libre.
 *
 * Pure and dependency-free, like `landed.ts` and `shipment.ts`, so the same math
 * runs in a script, in a Server Action and in a browser preview.
 *
 * Everything a spreadsheet normally hard-codes is an input here, because none of
 * these three is actually a constant:
 *   - `mlFeeRate` — ML's own `listing_prices` returns 16% on most categories and
 *     15.5% on some, for a Clásica (`gold_special`) listing. A Premium listing
 *     is 25.3%, which is why the listing type has to be a decision, not a guess.
 *   - `mlShippingCostArs` — above ML's free-shipping threshold the SELLER pays
 *     the shipping, and it scales with WEIGHT. A percentage-only model can't see
 *     this, and it is what quietly kills heavy low-value products.
 *   - `freightUsdPerKg` — measured from shipments that already landed, not a
 *     round number carried over from last year.
 *
 * Freight here is billed on actual weight. Couriers bill on max(actual,
 * volumetric), so a bulky-but-light product will come out cheaper on paper than
 * it really is — feed a volumetric weight in `weightGrams` when that matters.
 */

export interface MarginInput {
  /** Amazon list price for ONE unit, before US sales tax. */
  amazonPriceUsd: number
  /** US sales tax attributable to one unit. Optional — many orders show none. */
  amazonTaxUsd?: number
  /** Shipping weight of ONE unit, in grams. */
  weightGrams: number
  /** Asking price on Mercado Libre, in ARS. */
  mlPriceArs: number
  /** ARS per USD. From `getUsdArsRate()` — the rate we actually buy dollars at. */
  usdArsRate: number
  /** USA → Argentina freight, USD per kilogram. From `getFreightUsdPerKg()`. */
  freightUsdPerKg: number
  /** ML sale fee as a fraction, e.g. `0.16`. From `getSaleFee()`. */
  mlFeeRate: number
  /** ML's fixed per-sale charge in ARS. Zero above the low-price threshold. */
  mlFixedFeeArs?: number
  /** Free-shipping subsidy the seller absorbs, in ARS. From `getShippingCostArs()`. */
  mlShippingCostArs?: number
}

export interface MarginResult {
  /** This unit's share of the courier bill. */
  freightUsd: number
  /** Amazon price + tax + freight — the unit landed in Argentina. */
  landedUsd: number
  /** ML's commission on the sale price, in ARS. */
  mlFeeArs: number
  /** Sale price minus commission, fixed fee and the shipping we absorb. */
  netRevenueArs: number
  netRevenueUsd: number
  /** Net revenue minus landed cost. The number that matters. */
  netProfitUsd: number
  /** Profit over cost — "if I put in 100, how much comes back on top". */
  roiPct: number
  /** Profit over net revenue — the share of each sale we keep. */
  marginPct: number
  /**
   * ML price at which this product stops making money. The distance between
   * this and `mlPriceArs` is the room there is to be undercut.
   */
  breakEvenMlArs: number
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round0 = (n: number) => Math.round(n)
const nonNeg = (n: number | undefined) => Math.max(0, n ?? 0)

/** Freight for one unit at the measured per-kilo rate. */
export function unitFreightUsd(weightGrams: number, freightUsdPerKg: number): number {
  return round2((nonNeg(weightGrams) / 1000) * nonNeg(freightUsdPerKg))
}

/** Full cost/revenue breakdown for one unit of a candidate product. */
export function computeMargin(input: MarginInput): MarginResult {
  const freightUsd = unitFreightUsd(input.weightGrams, input.freightUsdPerKg)
  const landedUsd = round2(
    nonNeg(input.amazonPriceUsd) + nonNeg(input.amazonTaxUsd) + freightUsd
  )

  const price = nonNeg(input.mlPriceArs)
  const feeRate = Math.min(Math.max(input.mlFeeRate, 0), 1)
  const fixedFee = nonNeg(input.mlFixedFeeArs)
  const shipping = nonNeg(input.mlShippingCostArs)

  const mlFeeArs = round0(price * feeRate)
  const netRevenueArs = round0(price - mlFeeArs - fixedFee - shipping)

  const rate = input.usdArsRate > 0 ? input.usdArsRate : 0
  const netRevenueUsd = rate > 0 ? round2(netRevenueArs / rate) : 0
  const netProfitUsd = round2(netRevenueUsd - landedUsd)

  // Solve netProfitUsd = 0 for the sale price:
  //   P·(1 − feeRate) − fixedFee − shipping = landedUsd · rate
  const breakEvenMlArs =
    feeRate < 1 ? round0((landedUsd * rate + fixedFee + shipping) / (1 - feeRate)) : Infinity

  return {
    freightUsd,
    landedUsd,
    mlFeeArs,
    netRevenueArs,
    netRevenueUsd,
    netProfitUsd,
    roiPct: landedUsd > 0 ? round2((netProfitUsd / landedUsd) * 100) : 0,
    marginPct: netRevenueUsd > 0 ? round2((netProfitUsd / netRevenueUsd) * 100) : 0,
    breakEvenMlArs,
  }
}
