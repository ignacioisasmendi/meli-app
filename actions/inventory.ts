'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { BatchStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import {
  ON_HAND_STATUSES,
  applyAdjustment,
  applyStockWithCost,
  recomputeAverageCost,
} from '@/lib/inventory/stock'
import { checkLowStock } from '@/lib/inventory/alerts'
import { placeInFull } from '@/lib/inventory/full-shipments'
import { BATCH_LOCATION_VALUES, type BatchLocation } from '@/lib/statuses'
import type { ActionResult } from '@/actions/products'

const adjustSchema = z.object({
  productId: z.string().min(1),
  delta: z.coerce.number().int().refine((v) => v !== 0, 'Adjustment cannot be zero'),
  note: z.string().trim().optional().or(z.literal('')),
})

export async function adjustStock(formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = adjustSchema.safeParse({
    productId: formData.get('productId'),
    delta: formData.get('delta'),
    note: formData.get('note'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { productId, delta, note } = parsed.data

  await prisma.$transaction(async (tx) => {
    await applyAdjustment(tx, { productId, delta, note: note || undefined })
  })

  await checkLowStock(productId)

  revalidatePath('/inventory')
  revalidatePath(`/products/${productId}`)
  return { ok: true }
}

/** FULL is on hand in a Full warehouse; anything else is a plain batch status. */
function fromLocation(location: BatchLocation) {
  return location === 'FULL'
    ? { status: BatchStatus.AVAILABLE, placedInFull: true }
    : { status: location, placedInFull: false }
}

const addStockSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  quantity: z.coerce.number().int().positive('Quantity must be positive'),
  // `cost` is per unit or for all the units, depending on `costMode`.
  cost: z.coerce.number().positive('Cost must be positive'),
  costMode: z.enum(['unit', 'total']).default('unit'),
  status: z
    .union([z.nativeEnum(BatchStatus), z.literal('FULL')])
    .default(BatchStatus.AVAILABLE),
  receivedAt: z.string().optional(),
  note: z.string().trim().optional().or(z.literal('')),
})

/** Adds on-hand units with their cost, for stock that has no purchase behind it. */
export async function addStockWithCost(formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = addStockSchema.safeParse({
    productId: formData.get('productId'),
    quantity: formData.get('quantity'),
    cost: formData.get('cost'),
    costMode: formData.get('costMode') ?? undefined,
    status: formData.get('status') ?? undefined,
    receivedAt: formData.get('receivedAt') || undefined,
    note: formData.get('note'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { productId, quantity, cost, costMode, status, note } = parsed.data
  const receivedAt = parsed.data.receivedAt ? new Date(parsed.data.receivedAt) : new Date()
  if (Number.isNaN(receivedAt.getTime())) return { ok: false, error: 'Invalid date' }
  const unitCostUsd = costMode === 'total' ? cost / quantity : cost

  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) return { ok: false, error: 'Product not found' }

  await prisma.$transaction(async (tx) => {
    await applyStockWithCost(tx, {
      productId,
      quantity,
      unitCostUsd,
      ...fromLocation(status),
      receivedAt,
      note: note || undefined,
    })
  })

  await checkLowStock(productId)

  revalidatePath('/inventory')
  revalidatePath('/products')
  revalidatePath(`/products/${productId}`)
  return { ok: true }
}

/**
 * Moves a batch that has no purchase behind it (loaded with `addStockWithCost`),
 * including into or out of Full. Purchase-backed batches follow their purchase,
 * and batches in a shipment or a Full inbound follow that — changing them here
 * would split the two apart.
 */
export async function updateBatchStatus(
  batchId: string,
  location: BatchLocation
): Promise<ActionResult> {
  await requireUser()
  if (!BATCH_LOCATION_VALUES.includes(location)) return { ok: false, error: 'Invalid status' }
  const batch = await prisma.inventoryBatch.findUnique({ where: { id: batchId } })
  if (!batch) return { ok: false, error: 'Batch not found' }
  if (batch.purchaseId) {
    return { ok: false, error: 'This batch comes from a purchase — change it from Purchases' }
  }
  if (batch.shipmentId || batch.fullShipmentId) {
    return { ok: false, error: 'This batch is in a shipment — its status follows the shipment' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.inventoryBatch.update({ where: { id: batchId }, data: fromLocation(location) })
    // On-hand set may have changed → refresh average cost.
    await recomputeAverageCost(tx, batch.productId)
  })

  await checkLowStock(batch.productId)
  revalidateBatch(batch.productId)
  return { ok: true }
}

/**
 * Marks an on-hand batch as sitting in Full (or back at the depot) without a Full
 * box — for received stock, from a purchase or a shipment, that is already there.
 * Stock counters don't move: only which bucket the units show in.
 */
export async function setBatchInFull(batchId: string, inFull: boolean): Promise<ActionResult> {
  await requireUser()
  const batch = await prisma.inventoryBatch.findUnique({ where: { id: batchId } })
  if (!batch) return { ok: false, error: 'Batch not found' }
  if (!ON_HAND_STATUSES.includes(batch.status)) {
    return { ok: false, error: 'Only received stock can be in Full' }
  }
  if (batch.fullShipmentId) {
    return { ok: false, error: 'This batch went in a Full shipment — manage it from there' }
  }

  await prisma.inventoryBatch.update({ where: { id: batchId }, data: { placedInFull: inFull } })

  revalidateBatch(batch.productId)
  return { ok: true }
}

const moveFullSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().positive('Quantity must be positive'),
  toFull: z.boolean(),
})

/** Moves N units of a product into Full, or back to the depot, without a Full box. */
export async function moveStockToFull(
  input: z.input<typeof moveFullSchema>
): Promise<ActionResult> {
  await requireUser()
  const parsed = moveFullSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  try {
    await prisma.$transaction((tx) => placeInFull(tx, parsed.data))
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not move stock' }
  }
  revalidateBatch(parsed.data.productId)
  return { ok: true }
}

function revalidateBatch(productId: string) {
  revalidatePath('/inventory')
  revalidatePath('/products')
  revalidatePath('/full-shipments')
  revalidatePath(`/products/${productId}`)
}
