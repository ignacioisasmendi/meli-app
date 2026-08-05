/**
 * Import-freight allocation: splits one shipment's courier bill (freight +
 * customs + anything else) across the batches travelling inside it, producing
 * the per-unit freight that lands on each batch's cost.
 *
 * This is the piece `landed.ts` can't do. Supplier extras are known at purchase
 * time and allocated immediately; the USA → Argentina bill isn't known until
 * the box arrives, so it is applied here after the fact.
 *
 * Pure — the same math runs in the browser for the live preview and on the
 * server as the authority. The half that touches the database lives in
 * `shipment-costing.ts`.
 */

import { AllocationBasis } from '@prisma/client'

export interface FreightLine {
  quantity: number
  /** Weight of ONE unit, in grams. `null` when the product has none on file. */
  unitWeightGrams: number | null
  /** Supplier cost of one unit, ex-freight. */
  goodsUnitCostUsd: number
}

export interface AllocatedLine {
  /** This line's share of the bill, per unit. */
  freightUnitCostUsd: number
  /** `freightUnitCostUsd × quantity`, rounded — what the line actually absorbs. */
  freightTotalUsd: number
  /** Landed cost per unit = goods + freight. */
  unitCostUsd: number
  /** Fraction of the bill this line carries, 0–1. Drives the preview bar. */
  share: number
}

export interface AllocationResult {
  lines: AllocatedLine[]
  /** The basis actually used — may differ from the one asked for (see below). */
  basis: AllocationBasis
  /** Set when the requested basis was unusable, explaining the fallback. */
  fallbackReason: string | null
  /**
   * Bill minus the sum of the allocated line totals. Non-zero by a few cents
   * whenever the split doesn't divide evenly into whole cents per unit; shown
   * in the UI rather than silently absorbed somewhere.
   */
  residualUsd: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

const qtyOf = (l: FreightLine) => Math.max(0, Math.round(l.quantity))

/** Per-line weight for the split: unit weight × quantity, in grams. */
const weightOf = (l: FreightLine) => Math.max(0, l.unitWeightGrams ?? 0) * qtyOf(l)

/** Per-line value for the split: goods cost × quantity. */
const valueOf = (l: FreightLine) => Math.max(0, l.goodsUnitCostUsd) * qtyOf(l)

/**
 * Picks the basis that can actually be computed.
 *
 * WEIGHT needs every line to have a weight on file — allocating with some
 * weights missing would hand free freight to the products missing one, which is
 * worse than a uniform fallback. VALUE needs a non-zero total value, UNITS
 * needs units. Anything unusable degrades WEIGHT → VALUE → UNITS.
 */
export function resolveBasis(
  lines: FreightLine[],
  preferred: AllocationBasis
): { basis: AllocationBasis; fallbackReason: string | null } {
  const hasUnits = lines.some((l) => qtyOf(l) > 0)
  if (!hasUnits) return { basis: preferred, fallbackReason: null }

  const hasValue = lines.reduce((s, l) => s + valueOf(l), 0) > 0

  if (preferred === AllocationBasis.WEIGHT) {
    const missing = lines.filter(
      (l) => l.unitWeightGrams == null || l.unitWeightGrams <= 0
    ).length
    if (missing === 0) return { basis: AllocationBasis.WEIGHT, fallbackReason: null }
    return {
      basis: hasValue ? AllocationBasis.VALUE : AllocationBasis.UNITS,
      fallbackReason: `${missing} product${missing === 1 ? ' is' : 's are'} missing a weight — splitting by ${hasValue ? 'value' : 'units'} instead`,
    }
  }

  if (preferred === AllocationBasis.VALUE && !hasValue) {
    return {
      basis: AllocationBasis.UNITS,
      fallbackReason: 'No line has a cost yet — splitting evenly per unit instead',
    }
  }

  return { basis: preferred, fallbackReason: null }
}

/**
 * Splits `totalBillUsd` across `lines`.
 *
 * Weight basis, which is how couriers actually bill: a line's share is its
 * portion of the box's total weight, so the heavy cheap thing absorbs the
 * freight it caused instead of the light expensive one subsidising it. Packing
 * materials and any per-box overhead ride along in the total and get spread the
 * same way.
 */
export function allocateFreight(
  lines: FreightLine[],
  totalBillUsd: number,
  preferred: AllocationBasis = AllocationBasis.WEIGHT
): AllocationResult {
  const bill = Math.max(0, totalBillUsd)
  const { basis, fallbackReason } = resolveBasis(lines, preferred)

  const measure = (l: FreightLine) =>
    basis === AllocationBasis.WEIGHT
      ? weightOf(l)
      : basis === AllocationBasis.VALUE
        ? valueOf(l)
        : qtyOf(l)

  const total = lines.reduce((s, l) => s + measure(l), 0)

  const allocated = lines.map((l): AllocatedLine => {
    const qty = qtyOf(l)
    const share = total > 0 ? measure(l) / total : 0
    const freightUnitCostUsd = qty > 0 ? round2((bill * share) / qty) : 0
    return {
      freightUnitCostUsd,
      freightTotalUsd: round2(freightUnitCostUsd * qty),
      unitCostUsd: round2(Math.max(0, l.goodsUnitCostUsd) + freightUnitCostUsd),
      share,
    }
  })

  const residualUsd = round2(bill - allocated.reduce((s, a) => s + a.freightTotalUsd, 0))

  return { lines: allocated, basis, fallbackReason, residualUsd }
}

/**
 * Sum of a shipment's cost fields — the number that gets allocated.
 *
 * Local delivery is included from `localShippingUsd`, the figure frozen at
 * costing time, never re-derived from the pesos at today's rate.
 */
export function shipmentBill(shipment: {
  freightUsd: number | null
  customsUsd: number | null
  otherUsd: number | null
  localShippingUsd?: number | null
}): number {
  return round2(
    Math.max(0, shipment.freightUsd ?? 0) +
      Math.max(0, shipment.customsUsd ?? 0) +
      Math.max(0, shipment.otherUsd ?? 0) +
      Math.max(0, shipment.localShippingUsd ?? 0)
  )
}

/** Pesos → USD at a given ARS-per-USD rate, rounded to cents. */
export function arsToUsd(ars: number, usdArsRate: number): number {
  if (!(usdArsRate > 0)) return 0
  return round2(Math.max(0, ars) / usdArsRate)
}
