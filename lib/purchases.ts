/**
 * Read side of purchases, grouped the way they were actually paid: one supplier
 * order holding the per-product lines it was split into.
 *
 * The money is stored, never re-derived — a line's share of the order's tax and
 * shipping is whatever `allocateLandedCosts` booked into `totalCostUsd` at
 * import time, so re-importing into the same order (or editing the header
 * later) can't silently move a cost that is already on a batch.
 */

import { Prisma, PurchaseStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const round2 = (n: number) => Math.round(n * 100) / 100

export interface PurchaseLineMoney {
  quantity: number
  unitPriceUsd: number
  totalCostUsd: number
}

/** What the goods on this line cost, before the order's tax & shipping. */
export function lineGoodsUsd(line: PurchaseLineMoney): number {
  return round2(line.unitPriceUsd * line.quantity)
}

/** This line's share of the order's tax & shipping, exactly as booked. */
export function lineExtrasUsd(line: PurchaseLineMoney): number {
  return round2(line.totalCostUsd - line.unitPriceUsd * line.quantity)
}

export interface LineFreight {
  /** USA → Argentina freight already folded into this line's units. */
  totalUsd: number
  perUnitUsd: number
  /** True while that freight is a shipment estimate, not the courier's bill. */
  isEstimate: boolean
}

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

/**
 * Import freight carried by a line's batches. Normally one batch, but a line
 * split across boxes is averaged so the row still reads per unit.
 */
export function lineFreight(line: PurchaseOrderLine): LineFreight {
  const units = line.batches.reduce((n, b) => n + b.quantity, 0)
  const totalUsd = line.batches.reduce((n, b) => n + b.freightUnitCostUsd * b.quantity, 0)
  return {
    totalUsd: round2(totalUsd),
    perUnitUsd: units > 0 ? round2(totalUsd / units) : 0,
    isEstimate: line.batches.some((b) => b.freightUnitCostUsd > 0 && b.freightIsEstimate),
  }
}

export interface OrderSummary {
  lineCount: number
  units: number
  /** Goods only, at the supplier's list price. */
  goodsUsd: number
  /** Tax + shipping the supplier charged, spread across the lines. */
  extrasUsd: number
  /** goods + extras — what the order was actually billed at. */
  totalUsd: number
  /** USA → Argentina freight folded in so far by shipment costing. */
  freightUsd: number
  /** totalUsd + freightUsd — cost of the goods sitting in Argentina. */
  landedUsd: number
  /** True while any freight above is still a shipment estimate. */
  freightIsEstimate: boolean
  /** A single status when every line agrees, else null ("Mixed"). */
  status: PurchaseStatus | null
  shipments: { id: string; code: string }[]
}

/** Rolls a set of order lines up into the figures both purchase views show. */
export function summarizeOrder(lines: PurchaseOrderLine[]): OrderSummary {
  const shipments = new Map<string, { id: string; code: string }>()
  let units = 0
  let goodsUsd = 0
  let extrasUsd = 0
  let totalUsd = 0
  let freightUsd = 0
  let freightIsEstimate = false

  for (const line of lines) {
    units += line.quantity
    goodsUsd += lineGoodsUsd(line)
    extrasUsd += lineExtrasUsd(line)
    totalUsd += line.totalCostUsd
    for (const batch of line.batches) {
      freightUsd += batch.freightUnitCostUsd * batch.quantity
      if (batch.freightUnitCostUsd > 0 && batch.freightIsEstimate) freightIsEstimate = true
      if (batch.shipment) shipments.set(batch.shipment.id, batch.shipment)
    }
  }

  const statuses = new Set(lines.map((l) => l.status))

  return {
    lineCount: lines.length,
    units,
    goodsUsd: round2(goodsUsd),
    extrasUsd: round2(extrasUsd),
    totalUsd: round2(totalUsd),
    freightUsd: round2(freightUsd),
    landedUsd: round2(totalUsd + freightUsd),
    freightIsEstimate,
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
