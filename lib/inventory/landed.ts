/**
 * Landed-cost allocation: spreads order-level extras (tax + shipping) across
 * line items in proportion to each line's value, returning the per-unit cost
 * with that share folded in. Pure and dependency-free so the same math runs on
 * the client (live preview) and the server (authoritative).
 */

export interface LineInput {
  quantity: number
  /** Price for ONE unit, before tax and shipping. */
  unitPrice: number
}

export interface OrderExtras {
  /** Total tax for the order. */
  tax: number
  /** Net shipping & handling actually paid (after any free-shipping discount). */
  shipping: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

const lineValue = (l: LineInput) => Math.max(0, l.unitPrice) * Math.max(0, l.quantity)

/** Per-unit landed cost for each line, in the same order as `lines`. */
export function allocateLandedCosts(lines: LineInput[], extras: OrderExtras): number[] {
  const totalValue = lines.reduce((sum, l) => sum + lineValue(l), 0)
  const extra = Math.max(0, extras.tax) + Math.max(0, extras.shipping)

  return lines.map((l) => {
    const qty = Math.max(1, Math.round(l.quantity))
    const share = totalValue > 0 ? (extra * lineValue(l)) / totalValue : 0
    return round2(l.unitPrice + share / qty)
  })
}
