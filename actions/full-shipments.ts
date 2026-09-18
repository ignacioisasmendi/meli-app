'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { FullShipmentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { allocateToFull, listReceivedStock } from '@/lib/inventory/full-shipments'
import type { ActionResult } from '@/actions/products'

const fullShipmentSchema = z.object({
  accountId: z.string().trim().min(1, 'Account is required'),
  mlInboundId: z.string().trim().min(1, 'Inbound ID is required'),
  sentAt: z.coerce.date().optional(),
  notes: z.string().trim().optional().or(z.literal('')),
})

const fullLinesSchema = z
  .array(
    z.object({
      productId: z.string().min(1),
      quantity: z.coerce.number().int().min(0, 'Quantity cannot be negative'),
    })
  )
  .transform((lines) => lines.filter((l) => l.quantity > 0))

function revalidateFullShipment(id?: string) {
  revalidatePath('/full-shipments')
  if (id) revalidatePath(`/full-shipments/${id}`)
  revalidatePath('/inventory')
  revalidatePath('/products')
}

function parseLines(raw: FormDataEntryValue | null) {
  try {
    return fullLinesSchema.safeParse(raw ? JSON.parse(String(raw)) : [])
  } catch {
    return fullLinesSchema.safeParse(null)
  }
}

export async function createFullShipment(formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = fullShipmentSchema.safeParse({
    accountId: formData.get('accountId'),
    mlInboundId: formData.get('mlInboundId'),
    sentAt: formData.get('sentAt') || undefined,
    notes: formData.get('notes'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const clash = await prisma.fullShipment.findUnique({
    where: {
      accountId_mlInboundId: {
        accountId: parsed.data.accountId,
        mlInboundId: parsed.data.mlInboundId,
      },
    },
  })
  if (clash) return { ok: false, error: `Inbound "${parsed.data.mlInboundId}" already exists for that account` }

  // Per-product quantities picked in the create dialog, taken from received
  // stock — so the box holds exactly what you counted while packing it.
  const lines = parseLines(formData.get('lines'))
  if (!lines.success) {
    return { ok: false, error: lines.error.issues[0]?.message ?? 'Invalid products' }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.fullShipment.create({
        data: {
          accountId: parsed.data.accountId,
          mlInboundId: parsed.data.mlInboundId,
          sentAt: parsed.data.sentAt ?? new Date(),
          notes: parsed.data.notes || null,
        },
      })
      await allocateToFull(tx, created.id, lines.data)
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not create Full shipment' }
  }

  revalidateFullShipment()
  return { ok: true }
}

export async function updateFullShipment(id: string, formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = fullShipmentSchema.partial().safeParse({
    accountId: formData.get('accountId') ?? undefined,
    mlInboundId: formData.get('mlInboundId') ?? undefined,
    sentAt: formData.get('sentAt') || undefined,
    notes: formData.get('notes') ?? undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const current = await prisma.fullShipment.findUnique({ where: { id } })
  if (!current) return { ok: false, error: 'Full shipment not found' }

  if (parsed.data.mlInboundId && parsed.data.mlInboundId !== current.mlInboundId) {
    const clash = await prisma.fullShipment.findUnique({
      where: {
        accountId_mlInboundId: {
          accountId: parsed.data.accountId ?? current.accountId,
          mlInboundId: parsed.data.mlInboundId,
        },
      },
    })
    if (clash) return { ok: false, error: `Inbound "${parsed.data.mlInboundId}" already exists for that account` }
  }

  await prisma.fullShipment.update({
    where: { id },
    data: {
      ...(parsed.data.accountId ? { accountId: parsed.data.accountId } : {}),
      ...(parsed.data.mlInboundId ? { mlInboundId: parsed.data.mlInboundId } : {}),
      ...(parsed.data.sentAt ? { sentAt: parsed.data.sentAt } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
    },
  })

  revalidateFullShipment(id)
  return { ok: true }
}

/** Confirms receipt by hand, for when you don't want to wait on the cron. */
export async function markFullShipmentReceived(id: string): Promise<ActionResult> {
  await requireUser()
  const fullShipment = await prisma.fullShipment.findUnique({ where: { id } })
  if (!fullShipment) return { ok: false, error: 'Full shipment not found' }
  if (fullShipment.status === FullShipmentStatus.RECEIVED) {
    return { ok: false, error: 'Already marked received' }
  }

  await prisma.fullShipment.update({
    where: { id },
    data: { status: FullShipmentStatus.RECEIVED, receivedAt: new Date() },
  })

  revalidateFullShipment(id)
  return { ok: true }
}

export async function deleteFullShipment(id: string): Promise<ActionResult> {
  await requireUser()
  const fullShipment = await prisma.fullShipment.findUnique({ where: { id } })
  if (!fullShipment) return { ok: false, error: 'Full shipment not found' }
  if (fullShipment.status === FullShipmentStatus.RECEIVED) {
    return { ok: false, error: 'A received Full shipment cannot be deleted' }
  }

  // Batches survive with `fullShipmentId: null` (onDelete: SetNull) — deleting
  // the box puts its goods back into received stock.
  await prisma.fullShipment.delete({ where: { id } })
  revalidateFullShipment()
  return { ok: true }
}

/** Adds more received stock, per product, to a Full box that hasn't arrived. */
export async function addProductsToFull(
  fullShipmentId: string,
  input: { productId: string; quantity: number }[]
): Promise<ActionResult> {
  await requireUser()
  const lines = fullLinesSchema.safeParse(input)
  if (!lines.success) {
    return { ok: false, error: lines.error.issues[0]?.message ?? 'Invalid products' }
  }
  if (lines.data.length === 0) return { ok: false, error: 'Pick at least one product' }

  const fullShipment = await prisma.fullShipment.findUnique({ where: { id: fullShipmentId } })
  if (!fullShipment) return { ok: false, error: 'Full shipment not found' }
  if (fullShipment.status === FullShipmentStatus.RECEIVED) {
    return { ok: false, error: 'That Full shipment was already received — nothing left to add' }
  }

  try {
    await prisma.$transaction((tx) => allocateToFull(tx, fullShipmentId, lines.data))
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not add products' }
  }

  revalidateFullShipment(fullShipmentId)
  return { ok: true }
}

/**
 * Takes a product back out of a Full box that hasn't arrived: its batches return
 * to received stock. Batches split when they went in stay split — harmless, as
 * both halves carry the same cost.
 */
export async function removeProductFromFull(
  fullShipmentId: string,
  productId: string
): Promise<ActionResult> {
  await requireUser()
  const fullShipment = await prisma.fullShipment.findUnique({ where: { id: fullShipmentId } })
  if (!fullShipment) return { ok: false, error: 'Full shipment not found' }
  if (fullShipment.status === FullShipmentStatus.RECEIVED) {
    return { ok: false, error: 'A received Full shipment cannot be changed' }
  }

  await prisma.inventoryBatch.updateMany({
    where: { fullShipmentId, productId },
    data: { fullShipmentId: null },
  })

  revalidateFullShipment(fullShipmentId)
  return { ok: true }
}

/** Received stock per product — the pool the Full pickers draw from. */
export async function getReceivedStockForFull() {
  await requireUser()
  return listReceivedStock()
}
