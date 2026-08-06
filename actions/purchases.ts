'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { BatchStatus, PurchaseStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { applyPurchase, recomputeAverageCost } from '@/lib/inventory/stock'
import { sendTelegramMessage } from '@/lib/telegram/client'
import { purchaseRegisteredMessage } from '@/lib/telegram/messages'
import type { ActionResult } from '@/actions/products'

const purchaseSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  quantity: z.coerce.number().int().positive('Quantity must be positive'),
  unitCostUsd: z.coerce.number().positive('Unit cost must be positive'),
  supplier: z.string().trim().optional().or(z.literal('')),
  status: z.nativeEnum(PurchaseStatus).default(PurchaseStatus.PURCHASED),
  purchasedAt: z.string().optional(),
})

export async function registerPurchase(formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = purchaseSchema.safeParse({
    productId: formData.get('productId'),
    quantity: formData.get('quantity'),
    unitCostUsd: formData.get('unitCostUsd'),
    supplier: formData.get('supplier'),
    status: formData.get('status') ?? undefined,
    purchasedAt: formData.get('purchasedAt') ?? undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { productId, quantity, unitCostUsd, supplier, status } = parsed.data
  const purchasedAt = parsed.data.purchasedAt ? new Date(parsed.data.purchasedAt) : new Date()
  const totalCostUsd = quantity * unitCostUsd

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
