import 'server-only'
import type { InventoryBatch, Prisma, Purchase } from '@prisma/client'

/**
 * Splitting a purchase or batch in two, for goods that don't move together: part
 * of a line arrives (or ships, or goes to Full) and the rest doesn't yet.
 *
 * Both halves keep identical per-unit costs, so no landed cost, FIFO value or
 * shipment allocation moves — only which row the units sit on. Stock counters
 * on Product are untouched: the units were already counted once.
 */

type Tx = Prisma.TransactionClient

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Carves `take` units off a batch into a new batch. Only unsold units can move,
 * so both `quantity` and `remainingQuantity` drop by `take` on the original —
 * any sale consumptions stay on it and still reverse within its bounds.
 */
export async function splitBatch(
  tx: Tx,
  batch: InventoryBatch,
  take: number,
  overrides: Partial<
    Pick<InventoryBatch, 'purchaseId' | 'shipmentId' | 'fullShipmentId' | 'placedInFull'>
  > = {}
): Promise<InventoryBatch> {
  if (take <= 0 || take >= batch.quantity || take > batch.remainingQuantity) {
    throw new Error(`Cannot split ${take} unit(s) off a batch with ${batch.remainingQuantity} left`)
  }
  const created = await tx.inventoryBatch.create({
    data: {
      productId: batch.productId,
      purchaseId: batch.purchaseId,
      shipmentId: batch.shipmentId,
      fullShipmentId: batch.fullShipmentId,
      placedInFull: batch.placedInFull,
      ...overrides,
      quantity: take,
      remainingQuantity: take,
      goodsUnitCostUsd: batch.goodsUnitCostUsd,
      freightUnitCostUsd: batch.freightUnitCostUsd,
      unitCostUsd: batch.unitCostUsd,
      freightIsEstimate: batch.freightIsEstimate,
      status: batch.status,
      purchasedAt: batch.purchasedAt,
    },
  })
  await tx.inventoryBatch.update({
    where: { id: batch.id },
    data: {
      quantity: { decrement: take },
      remainingQuantity: { decrement: take },
    },
  })
  return created
}

/** Why a purchase can't be split, or null when it can. */
export function purchaseSplitBlocker(
  purchase: Purchase & { batches: InventoryBatch[] }
): string | null {
  const [batch] = purchase.batches
  if (purchase.batches.length !== 1 || batch.quantity !== purchase.quantity) {
    return 'This purchase is spread across several batches and cannot be split'
  }
  if (batch.remainingQuantity !== batch.quantity) {
    return 'Units of this purchase were already sold — it cannot be split'
  }
  return null
}

/**
 * Splits a purchase so it keeps `keep` units and a new purchase (with its own
 * batch) takes the rest. Tax, shipping and the billed total are prorated by
 * units, with rounding left on the original so the halves add back to the
 * invoice exactly. Callers check `purchaseSplitBlocker` first.
 */
export async function splitPurchase(
  tx: Tx,
  purchase: Purchase & { batches: InventoryBatch[] },
  keep: number,
  remainder: Partial<Pick<Purchase, 'arrivedAt'>> = {}
): Promise<{ purchase: Purchase; batch: InventoryBatch }> {
  const rest = purchase.quantity - keep
  if (keep <= 0 || rest <= 0) throw new Error(`Cannot keep ${keep} of ${purchase.quantity} units`)
  const blocker = purchaseSplitBlocker(purchase)
  if (blocker) throw new Error(blocker)

  const share = (amount: number) => round2((amount * rest) / purchase.quantity)
  const restTax = share(purchase.taxUsd)
  const restShipping = share(purchase.shippingUsd)
  const restTotal = share(purchase.totalCostUsd)

  const created = await tx.purchase.create({
    data: {
      productId: purchase.productId,
      orderId: purchase.orderId,
      quantity: rest,
      unitPriceUsd: purchase.unitPriceUsd,
      taxUsd: restTax,
      shippingUsd: restShipping,
      unitCostUsd: purchase.unitCostUsd,
      totalCostUsd: restTotal,
      supplier: purchase.supplier,
      invoiceUrl: purchase.invoiceUrl,
      status: purchase.status,
      purchasedAt: purchase.purchasedAt,
      arrivedAt: remainder.arrivedAt ?? null,
    },
  })
  await tx.purchase.update({
    where: { id: purchase.id },
    data: {
      quantity: keep,
      taxUsd: round2(purchase.taxUsd - restTax),
      shippingUsd: round2(purchase.shippingUsd - restShipping),
      totalCostUsd: round2(purchase.totalCostUsd - restTotal),
    },
  })
  const batch = await splitBatch(tx, purchase.batches[0], rest, { purchaseId: created.id })
  return { purchase: created, batch }
}
