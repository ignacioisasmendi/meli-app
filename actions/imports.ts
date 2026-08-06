'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { BatchStatus, PurchaseStatus, ShipmentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { applyPurchase, recomputeAverageCost } from '@/lib/inventory/stock'
import { allocateOrder } from '@/lib/inventory/landed'
import { SHIPMENT_TO_BATCH_STATUS } from '@/lib/inventory/shipment-costing'
import { sendTelegramMessage } from '@/lib/telegram/client'
import type { ActionResult } from '@/actions/products'

const importSchema = z.object({
  orderNumber: z.string().trim().optional().or(z.literal('')),
  supplier: z.string().trim().optional().or(z.literal('')),
  purchasedAt: z.string().optional(),
  tax: z.coerce.number().min(0).default(0),
  shipping: z.coerce.number().min(0).default(0),
  /** Box these lines travel in. Its freight is applied later, on arrival. */
  shipmentId: z.string().optional().or(z.literal('')),
  lines: z
    .array(
      z
        .object({
          mode: z.enum(['existing', 'new']),
          productId: z.string().optional(),
          sku: z.string().trim().optional(),
          name: z.string().trim().min(1, 'Product name is required'),
          quantity: z.coerce.number().int().positive('Quantity must be positive'),
          unitPrice: z.coerce.number().positive('Unit price must be positive'),
        })
        .refine((l) => (l.mode === 'existing' ? !!l.productId : !!l.sku), {
          message: 'Each line needs a product (or a SKU to create one)',
        })
    )
    .min(1, 'Add at least one line'),
})

export type ImportPayload = z.infer<typeof importSchema>

/**
 * Bulk-imports manually-entered purchases. The supplier's own tax + shipping are
 * allocated across lines (by value) into each line's per-unit cost, then a
 * product is created (when new) and a purchase + batch recorded through the
 * stock pipeline.
 *
 * Given an order number the lines are also grouped under a `PurchaseOrder`, so
 * the basket that was actually paid for stays one thing on the purchases page
 * and its tax/shipping can be shown line by line.
 *
 * That covers everything knowable at purchase time. The USA → Argentina freight
 * is not — it arrives with the box — so lines can be dropped into a shipment
 * here and re-costed later by `costShipment`.
 */
export async function importPurchases(payload: ImportPayload): Promise<ActionResult> {
  await requireUser()
  const parsed = importSchema.safeParse(payload)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { orderNumber, lines, tax, shipping } = parsed.data
  const purchasedAt = parsed.data.purchasedAt ? new Date(parsed.data.purchasedAt) : new Date()
  if (Number.isNaN(purchasedAt.getTime())) {
    return { ok: false, error: 'Invalid purchase date' }
  }

  const shipmentId = parsed.data.shipmentId || null
  let batchStatus: BatchStatus = BatchStatus.PURCHASED
  if (shipmentId) {
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } })
    if (!shipment) return { ok: false, error: 'Shipment not found' }
    if (shipment.status === ShipmentStatus.COSTED) {
      return { ok: false, error: 'That shipment is already costed — pick an open one' }
    }
    batchStatus = SHIPMENT_TO_BATCH_STATUS[shipment.status]
  }

  // Authoritative cost breakdown — recomputed server-side, never trusted from the client.
  const allocated = allocateOrder(
    lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })),
    { tax, shipping }
  )

  const supplier = parsed.data.supplier || 'Amazon'

  try {
    await prisma.$transaction(async (tx) => {
      // Re-importing an order number adds to it rather than forking a second
      // group: each import allocated its own extras over its own lines, so the
      // per-line costs already booked stay untouched and the header just sums.
      const order = orderNumber
        ? await tx.purchaseOrder.upsert({
            where: { supplier_orderNumber: { supplier, orderNumber } },
            create: { orderNumber, supplier, taxUsd: tax, shippingUsd: shipping, purchasedAt },
            update: { taxUsd: { increment: tax }, shippingUsd: { increment: shipping } },
          })
        : null

      for (const [i, line] of lines.entries()) {
        let productId = line.productId
        const { taxUsd, shippingUsd, totalUsd, unitCostUsd } = allocated[i]

        if (line.mode === 'new') {
          const sku = line.sku!.trim()
          const existing = await tx.product.findUnique({ where: { sku } })
          if (existing) {
            throw new Error(`SKU "${sku}" already exists — map that line to it instead`)
          }
          const created = await tx.product.create({ data: { sku, name: line.name } })
          productId = created.id
        } else {
          const product = await tx.product.findUnique({ where: { id: productId } })
          if (!product) throw new Error('A selected product no longer exists')
        }

        const purchase = await tx.purchase.create({
          data: {
            productId: productId!,
            orderId: order?.id,
            quantity: line.quantity,
            unitPriceUsd: line.unitPrice,
            taxUsd,
            shippingUsd,
            unitCostUsd,
            // The line was billed goods + tax + shipping; spreading that over
            // the units and multiplying back can drift a cent, so the billed
            // figure is what gets stored.
            totalCostUsd: totalUsd,
            supplier,
            status: batchStatus as unknown as PurchaseStatus,
            purchasedAt,
          },
        })
        await tx.inventoryBatch.create({
          data: {
            productId: productId!,
            purchaseId: purchase.id,
            shipmentId,
            quantity: line.quantity,
            remainingQuantity: line.quantity,
            // Freight is still unknown, so landed cost == goods cost for now.
            goodsUnitCostUsd: unitCostUsd,
            unitCostUsd,
            status: batchStatus,
            purchasedAt,
          },
        })
        await applyPurchase(tx, {
          productId: productId!,
          quantity: line.quantity,
          referenceId: purchase.id,
        })
        await recomputeAverageCost(tx, productId!)
      }
    })
  } catch (err) {
    console.error('[purchase import] failed:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not import purchases',
    }
  }

  const units = lines.reduce((n, l) => n + l.quantity, 0)
  await sendTelegramMessage(
    `🛒 Imported ${lines.length} product${lines.length === 1 ? '' : 's'} (${units} units)` +
      (orderNumber ? ` from order ${orderNumber}` : '')
  )

  revalidatePath('/purchases')
  revalidatePath('/inventory')
  revalidatePath('/products')
  revalidatePath('/shipments')
  if (shipmentId) revalidatePath(`/shipments/${shipmentId}`)
  return { ok: true }
}
