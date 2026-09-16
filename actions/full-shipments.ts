'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { FullShipmentStatus, ShipmentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import type { ActionResult } from '@/actions/products'

const fullShipmentSchema = z.object({
  accountId: z.string().trim().min(1, 'Account is required'),
  mlInboundId: z.string().trim().min(1, 'Inbound ID is required'),
  sentAt: z.coerce.date().optional(),
  notes: z.string().trim().optional().or(z.literal('')),
})

function revalidateFullShipment(id?: string) {
  revalidatePath('/full-shipments')
  if (id) revalidatePath(`/full-shipments/${id}`)
  revalidatePath('/shipments')
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

  // Shipments picked in the create dialog, so the packing summary you checked
  // against the physical box is exactly what ends up assigned to it.
  const shipmentIds = formData.getAll('shipmentIds').map(String).filter(Boolean)
  if (shipmentIds.length > 0) {
    const eligibleCount = await prisma.shipment.count({
      where: { id: { in: shipmentIds }, fullShipmentId: null, status: ShipmentStatus.COSTED },
    })
    if (eligibleCount !== shipmentIds.length) {
      return { ok: false, error: 'One of the selected shipments is no longer available' }
    }
  }

  await prisma.$transaction(async (tx) => {
    const created = await tx.fullShipment.create({
      data: {
        accountId: parsed.data.accountId,
        mlInboundId: parsed.data.mlInboundId,
        sentAt: parsed.data.sentAt ?? new Date(),
        notes: parsed.data.notes || null,
      },
    })
    if (shipmentIds.length > 0) {
      await tx.shipment.updateMany({
        where: { id: { in: shipmentIds } },
        data: { fullShipmentId: created.id },
      })
    }
  })

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

  // Shipments survive with `fullShipmentId: null` (onDelete: SetNull) — deleting
  // the box must never touch the goods that were consolidated into it.
  await prisma.fullShipment.delete({ where: { id } })
  revalidateFullShipment()
  return { ok: true }
}

/** Puts a set of shipments in (or, with `fullShipmentId: null`, out of) a Full box. */
export async function assignShipmentsToFull(
  shipmentIds: string[],
  fullShipmentId: string | null
): Promise<ActionResult> {
  await requireUser()
  if (shipmentIds.length === 0) return { ok: false, error: 'Select at least one shipment' }

  if (fullShipmentId) {
    const fullShipment = await prisma.fullShipment.findUnique({ where: { id: fullShipmentId } })
    if (!fullShipment) return { ok: false, error: 'Full shipment not found' }
    if (fullShipment.status === FullShipmentStatus.RECEIVED) {
      return { ok: false, error: 'That Full shipment was already received — nothing left to add' }
    }
  }

  await prisma.shipment.updateMany({
    where: { id: { in: shipmentIds } },
    data: { fullShipmentId },
  })

  revalidateFullShipment(fullShipmentId ?? undefined)
  return { ok: true }
}

/**
 * Landed shipments not yet consolidated into a Full box — the pool the picker
 * draws from. Only COSTED shipments qualify: their units are the ones actually
 * sellable, with a real landed cost, so that's what should be going to Full.
 */
export async function getShipmentsEligibleForFull() {
  await requireUser()
  return prisma.shipment.findMany({
    where: { fullShipmentId: null, status: ShipmentStatus.COSTED },
    include: {
      batches: {
        include: { product: { select: { id: true, name: true, sku: true } } },
      },
    },
    orderBy: { costedAt: 'desc' },
    take: 200,
  })
}
