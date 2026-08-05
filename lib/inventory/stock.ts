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
 * One batch's contribution to a sale's cost of goods. A null `batchId` is the
 * average-cost fallback below — units that no batch could account for.
 */
export interface ConsumedLine {
  batchId: string | null
  quantity: number
  unitCostUsd: number
}

/**
 * Consumes `quantity` units FIFO from on-hand batches, returning the USD cost of
 * goods sold. Updates sold/current counters, logs a SALE movement, and
 * recomputes average cost. Falls back to averageCostUsd if batches are short.
 *
 * Also returns the per-batch split it used. Persist it with
 * `recordSaleConsumption` once the Sale row exists — `reverseSale` needs it to
 * put returned units back where they came from.
 */
export async function applySale(
  tx: Tx,
  params: { productId: string; quantity: number; referenceId: string }
): Promise<{ costUsd: number; consumption: ConsumedLine[] }> {
  const { productId, quantity } = params

  const batches = await tx.inventoryBatch.findMany({
    where: { productId, status: { in: ON_HAND_STATUSES }, remainingQuantity: { gt: 0 } },
    orderBy: { purchasedAt: 'asc' },
  })

  const consumption: ConsumedLine[] = []
  let remaining = quantity
  let costUsd = 0
  for (const batch of batches) {
    if (remaining <= 0) break
    const take = Math.min(remaining, batch.remainingQuantity)
    costUsd += take * batch.unitCostUsd
    remaining -= take
    consumption.push({ batchId: batch.id, quantity: take, unitCostUsd: batch.unitCostUsd })
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
    consumption.push({
      batchId: null,
      quantity: remaining,
      unitCostUsd: product.averageCostUsd,
    })
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

  return { costUsd, consumption }
}

/** Persists the batch split `applySale` returned, once the Sale row has an id. */
export async function recordSaleConsumption(
  tx: Tx,
  saleId: string,
  consumption: ConsumedLine[]
) {
  if (consumption.length === 0) return
  await tx.saleBatchConsumption.createMany({
    data: consumption.map((line) => ({
      saleId,
      batchId: line.batchId,
      quantity: line.quantity,
      unitCostUsd: line.unitCostUsd,
    })),
  })
}

/**
 * The inverse of `applySale`: puts `quantity` units of a sale back.
 *
 * Un-consumes in reverse-FIFO order — the batch the sale reached *last* is
 * credited *first* — so a partial reversal leaves batches in exactly the state
 * they'd be in had only the kept units ever sold. Returns the COGS being backed
 * out, valued at the cost the units actually left at (frozen on the consumption
 * row), not today's average.
 *
 * `restock: false` is for goods that came back unsellable. The units still stop
 * counting as sold, but they don't return to any batch — instead the reversal is
 * paired with a negative ADJUSTMENT, which is what keeps
 * `currentStock = totalPurchased − totalSold + Σ adjustments` true.
 */
export async function reverseSale(
  tx: Tx,
  params: {
    productId: string
    saleId: string
    quantity: number
    restock: boolean
    note?: string
  }
): Promise<{ reversedCostUsd: number; restockedQuantity: number }> {
  const { productId, saleId, quantity, restock } = params
  if (quantity <= 0) return { reversedCostUsd: 0, restockedQuantity: 0 }

  // Callers in `returns.ts` clamp to a sale's unreversed units; this catches a
  // caller that doesn't. Reversing more than a product ever sold is always a bug,
  // and letting it through would silently leave `totalSold` negative.
  const counters = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: { totalSold: true },
  })
  if (quantity > counters.totalSold) {
    throw new Error(
      `Cannot reverse ${quantity} unit(s) of sale ${saleId}: product has only ${counters.totalSold} sold`
    )
  }

  const lines = await tx.saleBatchConsumption.findMany({
    where: { saleId },
    include: { batch: { select: { purchasedAt: true } } },
  })

  // Reverse-FIFO: average-cost fallback units were consumed after every batch
  // ran dry, so they unwind first; real batches then unwind newest-first.
  const ordered = [...lines].sort((a, b) => {
    if (!a.batch && !b.batch) return 0
    if (!a.batch) return -1
    if (!b.batch) return 1
    return b.batch.purchasedAt.getTime() - a.batch.purchasedAt.getTime()
  })

  let remaining = quantity
  let reversedCostUsd = 0
  for (const line of ordered) {
    if (remaining <= 0) break
    const restorable = line.quantity - line.restoredQuantity
    if (restorable <= 0) continue
    const give = Math.min(remaining, restorable)
    remaining -= give
    reversedCostUsd += give * line.unitCostUsd

    await tx.saleBatchConsumption.update({
      where: { id: line.id },
      data: { restoredQuantity: { increment: give } },
    })
    if (restock && line.batchId) {
      await tx.inventoryBatch.update({
        where: { id: line.batchId },
        data: { remainingQuantity: { increment: give } },
      })
    }
  }

  // Sales recorded before consumption tracking existed (or whose batches were
  // deleted) have nothing to credit — value those at the product's average cost,
  // the same fallback `applySale` uses when batches run short.
  if (remaining > 0) {
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { averageCostUsd: true },
    })
    reversedCostUsd += remaining * product.averageCostUsd
  }

  await tx.product.update({
    where: { id: productId },
    data: {
      totalSold: { decrement: quantity },
      ...(restock ? { currentStock: { increment: quantity } } : {}),
    },
  })
  await recordMovement(tx, {
    productId,
    type: MovementType.RETURN,
    quantity,
    referenceType: 'sale',
    referenceId: saleId,
    note: params.note,
  })

  if (!restock) {
    // Units are back off the books but never reached the shelf. Without this the
    // stock identity would drift by `quantity`.
    await recordMovement(tx, {
      productId,
      type: MovementType.ADJUSTMENT,
      quantity: -quantity,
      referenceType: 'sale',
      referenceId: saleId,
      note: params.note ? `Return written off: ${params.note}` : 'Return written off',
    })
  }

  await recomputeAverageCost(tx, productId)

  return { reversedCostUsd, restockedQuantity: restock ? quantity : 0 }
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
