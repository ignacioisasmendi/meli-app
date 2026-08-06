/**
 * Read side of purchases, grouped the way they were actually paid: one supplier
 * order holding the per-product lines it was split into, and every line split
 * again into the price of the goods, the tax, and the shipping that add up to it.
 *
 * Those three are read straight off the record, never re-derived from
 * `unitCostUsd`/`totalCostUsd` — `costShipment` rewrites those two with import
 * freight folded in, so the gap between them and the goods price stops being
 * "tax" the moment a shipment lands.
 */

import { Prisma, PurchaseStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const round2 = (n: number) => Math.round(n * 100) / 100

export const purchaseOrderWithLines = {
  purchases: {
    include: {
      product: { select: { id: true, name: true, sku: true, imageUrl: true } },
      batches: {
        select: {
          id: true,
          quantity: true,
          freightUnitCostUsd: true,
          unitCostUsd: true,
          freightIsEstimate: true,
          shipment: { select: { id: true, code: true } },
        },
      },
    },
    orderBy: { totalCostUsd: 'desc' },
  },
} satisfies Prisma.PurchaseOrderInclude

export type PurchaseOrderWithLines = Prisma.PurchaseOrderGetPayload<{
  include: typeof purchaseOrderWithLines
}>

export type PurchaseOrderLine = PurchaseOrderWithLines['purchases'][number]

export interface LineCosts {
  /** Goods at the supplier's list price, before anything is added. */
  goodsUsd: number
  taxUsd: number
  shippingUsd: number
  /** goods + tax + shipping — what the supplier billed for this line. */
  totalUsd: number
  /** One unit with tax & shipping in it. */
  unitCostUsd: number
  /** USA → Argentina freight folded in by shipment costing, 0 until then. */
  freightUsd: number
  freightPerUnitUsd: number
  /** True while that freight is a shipment estimate, not the courier's bill. */
  freightIsEstimate: boolean
  /** totalUsd + freightUsd — the goods standing in Argentina. */
  landedUsd: number
  landedUnitUsd: number
}

/**
 * What one line cost, broken into its parts. Freight comes off the line's
 * batches — normally one, but a line split across boxes is summed so the row
 * still reads per line.
 */
export function lineCosts(line: PurchaseOrderLine): LineCosts {
  const goodsUsd = round2(line.unitPriceUsd * line.quantity)
  const totalUsd = round2(goodsUsd + line.taxUsd + line.shippingUsd)
  const freightUsd = round2(
    line.batches.reduce((sum, b) => sum + b.freightUnitCostUsd * b.quantity, 0)
  )
  const units = Math.max(1, line.quantity)

  return {
    goodsUsd,
    taxUsd: line.taxUsd,
    shippingUsd: line.shippingUsd,
    totalUsd,
    unitCostUsd: round2(totalUsd / units),
    freightUsd,
    freightPerUnitUsd: round2(freightUsd / units),
    freightIsEstimate: line.batches.some((b) => b.freightUnitCostUsd > 0 && b.freightIsEstimate),
    landedUsd: round2(totalUsd + freightUsd),
    landedUnitUsd: round2((totalUsd + freightUsd) / units),
  }
}

export interface OrderSummary {
  lineCount: number
  units: number
  goodsUsd: number
  taxUsd: number
  shippingUsd: number
  /** goods + tax + shipping — the supplier's invoice total. */
  totalUsd: number
  freightUsd: number
  freightIsEstimate: boolean
  /** totalUsd + freightUsd. */
  landedUsd: number
  /** A single status when every line agrees, else null ("Mixed"). */
  status: PurchaseStatus | null
  shipments: { id: string; code: string }[]
}

/** Rolls a set of order lines up into the figures both purchase views show. */
export function summarizeOrder(lines: PurchaseOrderLine[]): OrderSummary {
  const shipments = new Map<string, { id: string; code: string }>()
  const totals = { units: 0, goodsUsd: 0, taxUsd: 0, shippingUsd: 0, totalUsd: 0, freightUsd: 0 }
  let freightIsEstimate = false

  for (const line of lines) {
    const costs = lineCosts(line)
    totals.units += line.quantity
    totals.goodsUsd += costs.goodsUsd
    totals.taxUsd += costs.taxUsd
    totals.shippingUsd += costs.shippingUsd
    totals.totalUsd += costs.totalUsd
    totals.freightUsd += costs.freightUsd
    if (costs.freightIsEstimate) freightIsEstimate = true
    for (const batch of line.batches) {
      if (batch.shipment) shipments.set(batch.shipment.id, batch.shipment)
    }
  }

  const statuses = new Set(lines.map((l) => l.status))

  return {
    lineCount: lines.length,
    units: totals.units,
    goodsUsd: round2(totals.goodsUsd),
    taxUsd: round2(totals.taxUsd),
    shippingUsd: round2(totals.shippingUsd),
    totalUsd: round2(totals.totalUsd),
    freightUsd: round2(totals.freightUsd),
    freightIsEstimate,
    landedUsd: round2(totals.totalUsd + totals.freightUsd),
    status: statuses.size === 1 ? [...statuses][0] : null,
    shipments: [...shipments.values()],
  }
}

export function listPurchaseOrders(take = 100) {
  return prisma.purchaseOrder.findMany({
    include: purchaseOrderWithLines,
    orderBy: { purchasedAt: 'desc' },
    take,
  })
}

export function getPurchaseOrder(id: string) {
  return prisma.purchaseOrder.findUnique({ where: { id }, include: purchaseOrderWithLines })
}

/**
 * One-off purchases registered by hand, which never belonged to an order. Shown
 * on their own so nothing is invisible just for lacking an order number.
 */
export function listUngroupedPurchases(take = 100) {
  return prisma.purchase.findMany({
    where: { orderId: null },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      batches: { select: { shipment: { select: { id: true, code: true } } }, take: 1 },
    },
    orderBy: { purchasedAt: 'desc' },
    take,
  })
}
