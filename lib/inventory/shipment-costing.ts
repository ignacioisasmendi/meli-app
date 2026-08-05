/**
 * Server half of shipment costing: reads a shipment's batches, runs the pure
 * allocation from `shipment.ts`, and writes the resulting landed costs back to
 * the batches, their purchases, and each product's average cost.
 */

import 'server-only'
import { BatchStatus, PurchaseStatus, ShipmentStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recomputeAverageCost } from '@/lib/inventory/stock'
import { allocateFreight, shipmentBill, type FreightLine } from '@/lib/inventory/shipment'

type Tx = Prisma.TransactionClient

/** Batch/purchase status implied by each stage of a shipment's journey. */
export const SHIPMENT_TO_BATCH_STATUS: Record<ShipmentStatus, BatchStatus> = {
  OPEN: BatchStatus.PURCHASED,
  IN_TRANSIT: BatchStatus.IN_TRANSIT,
  ARRIVED: BatchStatus.CUSTOMS,
  COSTED: BatchStatus.WAREHOUSE,
}

export interface CostingSummary {
  batchCount: number
  productCount: number
  totalBillUsd: number
  basis: string
  fallbackReason: string | null
  residualUsd: number
  /**
   * Units already sold out of the re-costed batches. Normally zero — a batch is
   * only sellable once it reaches WAREHOUSE, which is where costing puts it —
   * but non-zero if the batches were flipped on hand by hand before the bill
   * was entered. Those sales keep the profit they were booked with, since we
   * don't record which batch a sale consumed.
   */
  unitsAlreadySold: number
}

export const shipmentWithBatches = {
  batches: {
    include: {
      product: { select: { id: true, name: true, sku: true, weightGrams: true } },
    },
    orderBy: { purchasedAt: 'asc' },
  },
} satisfies Prisma.ShipmentInclude

export type ShipmentWithBatches = Prisma.ShipmentGetPayload<{
  include: typeof shipmentWithBatches
}>

/** Maps loaded batches into the shape the pure allocator expects. */
export function toFreightLines(shipment: ShipmentWithBatches): FreightLine[] {
  return shipment.batches.map((b) => ({
    quantity: b.quantity,
    unitWeightGrams: b.product.weightGrams,
    goodsUnitCostUsd: b.goodsUnitCostUsd,
  }))
}

/**
 * Applies a shipment's freight to its batches.
 *
 * `mode: 'estimate'` spreads `estimatedUsd` and leaves the batches flagged as
 * estimated and still in transit — enough to price listings sensibly while the
 * box is in the air. `mode: 'actual'` spreads the real bill, clears the flag,
 * and moves everything to WAREHOUSE, which is what makes the units sellable.
 *
 * Because a batch only becomes sellable at the moment it is costed, the
 * provisional cost normally never reaches a sale.
 */
export async function applyShipmentCosting(
  tx: Tx,
  shipmentId: string,
  mode: 'estimate' | 'actual'
): Promise<CostingSummary> {
  const shipment = await tx.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    include: shipmentWithBatches,
  })

  const totalBillUsd = mode === 'actual' ? shipmentBill(shipment) : Math.max(0, shipment.estimatedUsd)
  const allocation = allocateFreight(toFreightLines(shipment), totalBillUsd, shipment.basis)

  const isEstimate = mode === 'estimate'
  const batchStatus = isEstimate
    ? SHIPMENT_TO_BATCH_STATUS[shipment.status]
    : BatchStatus.WAREHOUSE

  const productIds = new Set<string>()
  let unitsAlreadySold = 0

  for (const [i, batch] of shipment.batches.entries()) {
    const { freightUnitCostUsd, unitCostUsd } = allocation.lines[i]
    productIds.add(batch.productId)
    unitsAlreadySold += batch.quantity - batch.remainingQuantity

    await tx.inventoryBatch.update({
      where: { id: batch.id },
      data: {
        freightUnitCostUsd,
        unitCostUsd,
        freightIsEstimate: isEstimate,
        status: batchStatus,
      },
    })

    // Keep the purchase row in step so the purchases table and any cost report
    // read the same landed figure as the batch.
    if (batch.purchaseId) {
      await tx.purchase.update({
        where: { id: batch.purchaseId },
        data: {
          unitCostUsd,
          totalCostUsd: Math.round(unitCostUsd * batch.quantity * 100) / 100,
          status: batchStatus as unknown as PurchaseStatus,
        },
      })
    }
  }

  for (const productId of productIds) {
    await recomputeAverageCost(tx, productId)
  }

  if (!isEstimate) {
    await tx.shipment.update({
      where: { id: shipmentId },
      data: { status: ShipmentStatus.COSTED, costedAt: new Date() },
    })
  }

  return {
    batchCount: shipment.batches.length,
    productCount: productIds.size,
    totalBillUsd,
    basis: allocation.basis,
    fallbackReason: allocation.fallbackReason,
    residualUsd: allocation.residualUsd,
    unitsAlreadySold,
  }
}

/** Loads a shipment with everything the detail page and preview need. */
export function getShipment(id: string) {
  return prisma.shipment.findUnique({ where: { id }, include: shipmentWithBatches })
}
