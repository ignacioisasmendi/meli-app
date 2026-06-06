import 'server-only'
import { prisma } from '@/lib/prisma'
import { BatchStatus, MovementType, Prisma } from '@prisma/client'

/** Batch statuses that represent goods not yet physically available. */
export const IN_TRANSIT_STATUSES: BatchStatus[] = [
  BatchStatus.PURCHASED,
  BatchStatus.IN_USA,
  BatchStatus.IN_TRANSIT,
  BatchStatus.CUSTOMS,
]

/** Batch statuses that represent goods on hand. */
export const ON_HAND_STATUSES: BatchStatus[] = [
  BatchStatus.WAREHOUSE,
  BatchStatus.AVAILABLE,
]

type Tx = Prisma.TransactionClient

export interface StockView {
  currentStock: number
  inTransit: number
  reserved: number
  available: number
}

/**
 * Computes the inventory view for a product.
 *   currentStock = totalPurchased − totalSold + Σ adjustments (denormalized on Product)
 *   inTransit    = Σ remainingQuantity of in-transit batches
 *   available    = currentStock − inTransit − reserved
 */
export function stockViewFrom(
  product: { currentStock: number; reservedStock: number },
  inTransit: number
): StockView {
  const available = Math.max(0, product.currentStock - inTransit - product.reservedStock)
  return {
    currentStock: product.currentStock,
    inTransit,
    reserved: product.reservedStock,
    available,
  }
}

/** Sum of remaining quantity across a product's in-transit batches. */
export async function getInTransit(productId: string, client: Tx | typeof prisma = prisma) {
  const agg = await client.inventoryBatch.aggregate({
    where: { productId, status: { in: IN_TRANSIT_STATUSES } },
    _sum: { remainingQuantity: true },
  })
  return agg._sum.remainingQuantity ?? 0
}

export async function getStockView(productId: string): Promise<StockView> {
  const [product, inTransit] = await Promise.all([
    prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { currentStock: true, reservedStock: true },
    }),
    getInTransit(productId),
  ])
  return stockViewFrom(product, inTransit)
}

/**
 * Recomputes a product's weighted-average unit cost (USD) from on-hand batches.
 * Falls back to keeping the last value when there are no on-hand units.
 */
export async function recomputeAverageCost(tx: Tx, productId: string): Promise<number> {
  const batches = await tx.inventoryBatch.findMany({
    where: { productId, status: { in: ON_HAND_STATUSES }, remainingQuantity: { gt: 0 } },
    select: { remainingQuantity: true, unitCostUsd: true },
  })
  const totalQty = batches.reduce((s, b) => s + b.remainingQuantity, 0)
  if (totalQty === 0) return 0
  const totalCost = batches.reduce((s, b) => s + b.remainingQuantity * b.unitCostUsd, 0)
  const avg = totalCost / totalQty
  await tx.product.update({ where: { id: productId }, data: { averageCostUsd: avg } })
  return avg
}

export async function recordMovement(
  tx: Tx,
  params: {
    productId: string
    type: MovementType
    quantity: number
    referenceType?: string
    referenceId?: string
    note?: string
  }
) {
  return tx.inventoryMovement.create({ data: params })
}

/**
 * Applies a purchase to inventory: bumps purchased + current counters and logs
 * a PURCHASE movement. The batch itself (in-transit) is created by the caller,
 * so `available` is unchanged until the batch lands.
 */
export async function applyPurchase(
  tx: Tx,
  params: { productId: string; quantity: number; referenceId: string }
) {
  await tx.product.update({
    where: { id: params.productId },
    data: {
      totalPurchased: { increment: params.quantity },
      currentStock: { increment: params.quantity },
    },
  })
  await recordMovement(tx, {
    productId: params.productId,
    type: MovementType.PURCHASE,
    quantity: params.quantity,
    referenceType: 'purchase',
    referenceId: params.referenceId,
  })
}

/**
 * Consumes `quantity` units FIFO from on-hand batches, returning the USD cost of
 * goods sold. Updates sold/current counters, logs a SALE movement, and
 * recomputes average cost. Falls back to averageCostUsd if batches are short.
 */
export async function applySale(
  tx: Tx,
  params: { productId: string; quantity: number; referenceId: string }
): Promise<{ costUsd: number }> {
  const { productId, quantity } = params

  const batches = await tx.inventoryBatch.findMany({
    where: { productId, status: { in: ON_HAND_STATUSES }, remainingQuantity: { gt: 0 } },
    orderBy: { purchasedAt: 'asc' },
  })

  let remaining = quantity
  let costUsd = 0
  for (const batch of batches) {
    if (remaining <= 0) break
    const take = Math.min(remaining, batch.remainingQuantity)
    costUsd += take * batch.unitCostUsd
    remaining -= take
    await tx.inventoryBatch.update({
      where: { id: batch.id },
      data: { remainingQuantity: { decrement: take } },
    })
  }

  // If we couldn't source the whole quantity from batches, value the rest at the
  // product's average cost so profit math still works.
  if (remaining > 0) {
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { averageCostUsd: true },
    })
    costUsd += remaining * product.averageCostUsd
  }

  await tx.product.update({
    where: { id: productId },
    data: {
      totalSold: { increment: quantity },
      currentStock: { decrement: quantity },
    },
  })
  await recordMovement(tx, {
    productId,
    type: MovementType.SALE,
    quantity,
    referenceType: 'sale',
    referenceId: params.referenceId,
  })
  await recomputeAverageCost(tx, productId)

  return { costUsd }
}

/** Applies a signed manual stock adjustment and logs an ADJUSTMENT movement. */
export async function applyAdjustment(
  tx: Tx,
  params: { productId: string; delta: number; note?: string }
) {
  await tx.product.update({
    where: { id: params.productId },
    data: { currentStock: { increment: params.delta } },
  })
  await recordMovement(tx, {
    productId: params.productId,
    type: MovementType.ADJUSTMENT,
    quantity: params.delta,
    referenceType: 'adjustment',
    note: params.note,
  })
}
