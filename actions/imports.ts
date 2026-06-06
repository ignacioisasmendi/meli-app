'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { BatchStatus, PurchaseStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { applyPurchase, recomputeAverageCost } from '@/lib/inventory/stock'
import { allocateLandedCosts } from '@/lib/inventory/landed'
import { sendTelegramMessage } from '@/lib/telegram/client'
import type { ActionResult } from '@/actions/products'

const importSchema = z.object({
  orderNumber: z.string().trim().optional().or(z.literal('')),
  supplier: z.string().trim().optional().or(z.literal('')),
  purchasedAt: z.string().optional(),
  tax: z.coerce.number().min(0).default(0),
  shipping: z.coerce.number().min(0).default(0),
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
 * Bulk-imports manually-entered purchases. Tax + shipping are allocated across
 * lines (by value) into each line's per-unit cost, then a product is created
 * (when new) and a purchase + batch recorded through the stock pipeline.
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

  // Authoritative landed cost — recomputed server-side, never trusted from the client.
  const landed = allocateLandedCosts(
    lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })),
    { tax, shipping }
  )

  const base = parsed.data.supplier || 'Amazon'
  const supplier = orderNumber ? `${base} · ${orderNumber}` : base

  try {
    await prisma.$transaction(async (tx) => {
      for (const [i, line] of lines.entries()) {
        let productId = line.productId
        const unitCostUsd = landed[i]

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

        const totalCostUsd = line.quantity * unitCostUsd
        const purchase = await tx.purchase.create({
          data: {
            productId: productId!,
            quantity: line.quantity,
            unitCostUsd,
            totalCostUsd,
            supplier,
            status: PurchaseStatus.PURCHASED,
            purchasedAt,
          },
        })
        await tx.inventoryBatch.create({
          data: {
            productId: productId!,
            purchaseId: purchase.id,
            quantity: line.quantity,
            remainingQuantity: line.quantity,
            unitCostUsd,
            status: BatchStatus.PURCHASED,
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
  return { ok: true }
}
