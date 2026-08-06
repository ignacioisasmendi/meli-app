/**
 * Landed-cost allocation: spreads order-level extras (tax + shipping) across
 * line items in proportion to each line's value. Pure and dependency-free so
 * the same math runs on the client (live preview) and the server (authoritative).
 *
 * Tax and shipping are allocated separately and kept separate, because that is
 * how the purchase is read back: a line's price and its tax are two figures that
 * add up to what the line cost, not one blended number.
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

export interface AllocatedLine {
  /** Goods at the supplier's list price: unitPrice × quantity. */
  goodsUsd: number
  /** This line's share of the order's tax. */
  taxUsd: number
  /** This line's share of the order's shipping. */
  shippingUsd: number
  /** goods + tax + shipping — what this line actually cost. */
  totalUsd: number
  /** `totalUsd` spread back over the units: one unit, tax included. */
  unitCostUsd: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

const lineValue = (l: LineInput) => Math.max(0, l.unitPrice) * Math.max(0, l.quantity)

const units = (l: LineInput) => Math.max(1, Math.round(l.quantity))

/**
 * Splits one order-level amount across lines by value, in cents, giving the
 * rounding residual to the largest line. Without that the parts can miss the
 * whole by a cent or two and the per-line tax would never add back up to the
 * tax on the invoice.
 */
function splitByValue(amount: number, values: number[], total: number): number[] {
  if (amount <= 0 || total <= 0) return values.map(() => 0)

  const parts = values.map((v) => round2((amount * v) / total))
  const drift = round2(amount - parts.reduce((sum, p) => sum + p, 0))
  if (drift !== 0) {
    const biggest = values.reduce((best, v, i) => (v > values[best] ? i : best), 0)
    parts[biggest] = round2(parts[biggest] + drift)
  }
  return parts
}

/** Full cost breakdown for each line, in the same order as `lines`. */
export function allocateOrder(lines: LineInput[], extras: OrderExtras): AllocatedLine[] {
  const values = lines.map(lineValue)
  const totalValue = values.reduce((sum, v) => sum + v, 0)

  const tax = splitByValue(Math.max(0, extras.tax), values, totalValue)
  const shipping = splitByValue(Math.max(0, extras.shipping), values, totalValue)

  return lines.map((line, i) => {
    const goodsUsd = round2(lineValue(line))
    const totalUsd = round2(goodsUsd + tax[i] + shipping[i])
    return {
      goodsUsd,
      taxUsd: tax[i],
      shippingUsd: shipping[i],
      totalUsd,
      unitCostUsd: round2(totalUsd / units(line)),
    }
  })
}

/** Per-unit landed cost for each line, in the same order as `lines`. */
export function allocateLandedCosts(lines: LineInput[], extras: OrderExtras): number[] {
  return allocateOrder(lines, extras).map((l) => l.unitCostUsd)
}
