'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { applyAdjustment } from '@/lib/inventory/stock'
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
