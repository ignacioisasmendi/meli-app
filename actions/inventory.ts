'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { applyAdjustment, applyStockWithCost } from '@/lib/inventory/stock'
import { checkLowStock } from '@/lib/inventory/alerts'
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

const addStockSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  quantity: z.coerce.number().int().positive('Quantity must be positive'),
  // `cost` is per unit or for all the units, depending on `costMode`.
  cost: z.coerce.number().positive('Cost must be positive'),
  costMode: z.enum(['unit', 'total']).default('unit'),
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
    receivedAt: formData.get('receivedAt') || undefined,
    note: formData.get('note'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { productId, quantity, cost, costMode, note } = parsed.data
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
