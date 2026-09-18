'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { BatchStatus, PurchaseStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { applyPurchase, recomputeAverageCost, statusOnArrival } from '@/lib/inventory/stock'
import { purchaseSplitBlocker, splitPurchase } from '@/lib/inventory/split'
import { sendTelegramMessage } from '@/lib/telegram/client'
import { purchaseRegisteredMessage } from '@/lib/telegram/messages'
import type { ActionResult } from '@/actions/products'

const purchaseSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  quantity: z.coerce.number().int().positive('Quantity must be positive'),
  // `cost` is per unit or for the whole line, depending on `costMode`.
  cost: z.coerce.number().positive('Cost must be positive'),
  costMode: z.enum(['unit', 'total']).default('unit'),
  supplier: z.string().trim().optional().or(z.literal('')),
  status: z.nativeEnum(PurchaseStatus).default(PurchaseStatus.PURCHASED),
  purchasedAt: z.string().optional(),
  arrivedAt: z.string().optional(),
})

export async function registerPurchase(formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = purchaseSchema.safeParse({
    productId: formData.get('productId'),
    quantity: formData.get('quantity'),
    cost: formData.get('cost'),
    costMode: formData.get('costMode') ?? undefined,
    supplier: formData.get('supplier'),
    status: formData.get('status') ?? undefined,
    purchasedAt: formData.get('purchasedAt') ?? undefined,
    arrivedAt: formData.get('arrivedAt') || undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { productId, quantity, cost, costMode, supplier } = parsed.data
  const purchasedAt = parsed.data.purchasedAt ? new Date(parsed.data.purchasedAt) : new Date()
  const arrivedAt = parsed.data.arrivedAt ? new Date(parsed.data.arrivedAt) : null
  if (arrivedAt && Number.isNaN(arrivedAt.getTime())) {
    return { ok: false, error: 'Invalid arrival date' }
  }
  // A one-off purchase is never in a shipment yet, so arriving marks it at the courier.
  const status = arrivedAt
    ? (statusOnArrival(parsed.data.status as unknown as BatchStatus, false) as unknown as PurchaseStatus)
    : parsed.data.status
  // Keep whichever figure was typed exact; the other is derived from it.
  const unitCostUsd = costMode === 'total' ? cost / quantity : cost
  const totalCostUsd = costMode === 'total' ? cost : quantity * cost

  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) return { ok: false, error: 'Product not found' }

  await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        productId,
        quantity,
        // A one-off purchase carries no order-level extras to allocate, so the
        // price paid is already the landed-in-the-USA cost.
        unitPriceUsd: unitCostUsd,
        unitCostUsd,
        totalCostUsd,
        supplier: supplier || null,
        status,
        purchasedAt,
        arrivedAt,
      },
    })
    await tx.inventoryBatch.create({
      data: {
        productId,
        purchaseId: purchase.id,
        quantity,
        remainingQuantity: quantity,
        // No import freight yet — a shipment folds that in when the box lands.
        goodsUnitCostUsd: unitCostUsd,
        unitCostUsd,
        status: status as unknown as BatchStatus,
        purchasedAt,
      },
    })
    await applyPurchase(tx, { productId, quantity, referenceId: purchase.id })
    await recomputeAverageCost(tx, productId)
  })

  await sendTelegramMessage(
    purchaseRegisteredMessage({
      productName: product.name,
      quantity,
      unitCostUsd,
      totalCostUsd,
    })
  )

  revalidatePath('/purchases')
  revalidatePath('/inventory')
  revalidatePath(`/products/${productId}`)
  return { ok: true }
}

export async function updatePurchaseStatus(
  purchaseId: string,
  status: PurchaseStatus
): Promise<ActionResult> {
  await requireUser()
  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } })
  if (!purchase) return { ok: false, error: 'Purchase not found' }

  await prisma.$transaction(async (tx) => {
    await tx.purchase.update({ where: { id: purchaseId }, data: { status } })
    await tx.inventoryBatch.updateMany({
      where: { purchaseId },
      data: { status: status as unknown as BatchStatus },
    })
    // On-hand set may have changed → refresh average cost.
    await recomputeAverageCost(tx, purchase.productId)
  })

  revalidatePath('/purchases')
  if (purchase.orderId) revalidatePath(`/purchases/orders/${purchase.orderId}`)
  revalidatePath('/inventory')
  revalidatePath(`/products/${purchase.productId}`)
  return { ok: true }
}

/** Moves every line of an order together — the box travels as one. */
export async function updateOrderStatus(
  orderId: string,
  status: PurchaseStatus
): Promise<ActionResult> {
  await requireUser()
  const lines = await prisma.purchase.findMany({
    where: { orderId },
    select: { id: true, productId: true },
  })
  if (lines.length === 0) return { ok: false, error: 'Order not found' }

  await prisma.$transaction(async (tx) => {
    await tx.purchase.updateMany({ where: { orderId }, data: { status } })
    await tx.inventoryBatch.updateMany({
      where: { purchaseId: { in: lines.map((l) => l.id) } },
      data: { status: status as unknown as BatchStatus },
    })
    for (const productId of new Set(lines.map((l) => l.productId))) {
      await recomputeAverageCost(tx, productId)
    }
  })

  revalidatePath('/purchases')
  revalidatePath(`/purchases/orders/${orderId}`)
  revalidatePath('/inventory')
  for (const productId of new Set(lines.map((l) => l.productId))) {
    revalidatePath(`/products/${productId}`)
  }
  return { ok: true }
}

const estimatedArrivalSchema = z.object({
  purchaseId: z.string().min(1),
  /** `yyyy-MM-dd`, or empty to clear the estimate. */
  estimatedArrivalAt: z.string(),
  /** Also move every other not-yet-arrived line of the same supplier order. */
  wholeOrder: z.boolean().default(false),
})

/**
 * Sets (or clears) when a purchase is expected at the courier. A revisable
 * guess, so it only touches the date: status, batches and stock are left to
 * `registerArrival` once the goods actually land.
 */
export async function updateEstimatedArrival(
  input: z.input<typeof estimatedArrivalSchema>
): Promise<ActionResult> {
  await requireUser()
  const parsed = estimatedArrivalSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { purchaseId, wholeOrder } = parsed.data
  const date = parsed.data.estimatedArrivalAt ? new Date(parsed.data.estimatedArrivalAt) : null
  if (date && Number.isNaN(date.getTime())) return { ok: false, error: 'Invalid date' }

  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } })
  if (!purchase) return { ok: false, error: 'Purchase not found' }

  await prisma.purchase.updateMany({
    where:
      wholeOrder && purchase.orderId
        ? { orderId: purchase.orderId, arrivedAt: null }
        : { id: purchase.id },
    data: { estimatedArrivalAt: date },
  })

  revalidatePath('/purchases')
  if (purchase.orderId) revalidatePath(`/purchases/orders/${purchase.orderId}`)
  return { ok: true }
}

const arrivalSchema = z.object({
  purchaseId: z.string().min(1),
  arrivedAt: z.string().min(1, 'Arrival date is required'),
  quantity: z.coerce.number().int().positive('Quantity must be positive'),
})

/**
 * Records when a purchase's goods reached the courier in the USA. Arriving with
 * fewer units than the line holds splits it in two — the arrived units keep this
 * row and the date, the rest move to a new purchase (and batch) still waiting —
 * so every row has exactly one arrival date. See `splitPurchase`.
 *
 * Calling it again on an arrived purchase just changes the date.
 */
export async function registerArrival(
  input: z.input<typeof arrivalSchema>
): Promise<ActionResult> {
  await requireUser()
  const parsed = arrivalSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { purchaseId, quantity } = parsed.data
  const arrivedAt = new Date(parsed.data.arrivedAt)
  if (Number.isNaN(arrivedAt.getTime())) return { ok: false, error: 'Invalid arrival date' }

  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: { batches: true },
  })
  if (!purchase) return { ok: false, error: 'Purchase not found' }
  if (quantity > purchase.quantity) {
    return { ok: false, error: `This purchase only has ${purchase.quantity} units` }
  }

  const splitting = quantity < purchase.quantity
  if (splitting) {
    if (purchase.arrivedAt) {
      return { ok: false, error: 'This purchase already arrived — only its date can change' }
    }
    const blocker = purchaseSplitBlocker(purchase)
    if (blocker) return { ok: false, error: blocker }
  }

  await prisma.$transaction(async (tx) => {
    if (splitting) await splitPurchase(tx, purchase, quantity)

    const inShipment = purchase.batches.some((b) => b.shipmentId)
    const status = statusOnArrival(purchase.status as unknown as BatchStatus, inShipment)
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { arrivedAt, status: status as unknown as PurchaseStatus },
    })
    await tx.inventoryBatch.updateMany({
      where: { purchaseId: purchase.id, shipmentId: null },
      data: { status },
    })
  })

  revalidatePath('/purchases')
  if (purchase.orderId) revalidatePath(`/purchases/orders/${purchase.orderId}`)
  revalidatePath('/inventory')
  revalidatePath('/products')
  revalidatePath(`/products/${purchase.productId}`)
  return { ok: true }
}
