'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { receiveReturn, cancelSale, openReturn } from '@/lib/inventory/returns'
import { getInTransit, stockViewFrom } from '@/lib/inventory/stock'
import { sendTelegramMessage } from '@/lib/telegram/client'
import { returnReceivedMessage } from '@/lib/telegram/messages'
import type { ActionResult } from '@/actions/products'

const receiveReturnSchema = z.object({
  saleId: z.string().min(1),
  quantity: z.coerce.number().int().positive().optional(),
  resellable: z.coerce.boolean(),
  note: z.string().trim().max(300).optional().or(z.literal('')),
})

/**
 * Confirms returned goods are physically in hand — the step that actually puts
 * units back on the shelf. `resellable: false` writes them off instead.
 */
export async function confirmReturnReceived(formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = receiveReturnSchema.safeParse({
    saleId: formData.get('saleId'),
    quantity: formData.get('quantity') || undefined,
    resellable: formData.get('resellable') === 'true',
    note: formData.get('note'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { saleId, quantity, resellable, note } = parsed.data

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: { product: { select: { id: true, name: true } } },
  })
  if (!sale) return { ok: false, error: 'Sale not found' }

  const result = await receiveReturn({
    saleId,
    quantity,
    resellable,
    note: note || undefined,
  })
  if (result.status === 'noop') {
    return { ok: false, error: 'This return has already been received' }
  }

  const product = await prisma.product.findUniqueOrThrow({ where: { id: sale.product.id } })
  const view = stockViewFrom(product, await getInTransit(product.id))
  await sendTelegramMessage(
    returnReceivedMessage({
      productName: sale.product.name,
      quantity: result.quantity,
      resellable,
      availableStock: view.available,
    })
  )

  revalidatePath('/sales')
  revalidatePath('/inventory')
  revalidatePath('/dashboard')
  revalidatePath(`/products/${sale.product.id}`)
  return { ok: true }
}

const reverseSchema = z.object({
  saleId: z.string().min(1),
  quantity: z.coerce.number().int().positive().optional(),
  reason: z.string().trim().max(300).optional().or(z.literal('')),
})

/**
 * Manual cancellation, for when a sale falls through without ML telling us —
 * buyer cancels off-platform, or the claim webhook never lands. Restocks
 * immediately, so only use it for orders that never shipped.
 */
export async function cancelSaleManually(formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = reverseSchema.safeParse({
    saleId: formData.get('saleId'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const result = await cancelSale({
    saleId: parsed.data.saleId,
    reason: parsed.data.reason || 'Cancelled manually',
  })
  if (result.status === 'noop') {
    return { ok: false, error: 'This sale has already been reversed' }
  }

  revalidatePath('/sales')
  revalidatePath('/inventory')
  revalidatePath('/dashboard')
  return { ok: true }
}

/**
 * Manually flags a sale as being returned, for a return agreed off-platform.
 * Reverses the money now; stock waits for `confirmReturnReceived`.
 */
export async function openReturnManually(formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = reverseSchema.safeParse({
    saleId: formData.get('saleId'),
    quantity: formData.get('quantity') || undefined,
    reason: formData.get('reason'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const result = await openReturn({
    saleId: parsed.data.saleId,
    quantity: parsed.data.quantity,
    reason: parsed.data.reason || 'Return opened manually',
  })
  if (result.status === 'noop') {
    return { ok: false, error: 'This sale has already been reversed' }
  }

  revalidatePath('/sales')
  revalidatePath('/dashboard')
  return { ok: true }
}
