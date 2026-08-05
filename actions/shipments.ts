'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { AllocationBasis, PurchaseStatus, ShipmentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import {
  applyShipmentCosting,
  SHIPMENT_TO_BATCH_STATUS,
  type CostingSummary,
} from '@/lib/inventory/shipment-costing'
import { IN_TRANSIT_STATUSES, recomputeAverageCost } from '@/lib/inventory/stock'
import { arsToUsd } from '@/lib/inventory/shipment'
import { getUsdArsRate } from '@/lib/settings'
import { sendTelegramMessage } from '@/lib/telegram/client'
import { shipmentCostedMessage } from '@/lib/telegram/messages'
import type { ActionResult } from '@/actions/products'

const shipmentSchema = z.object({
  code: z.string().trim().min(1, 'Code is required'),
  courier: z.string().trim().optional().or(z.literal('')),
  basis: z.nativeEnum(AllocationBasis).default(AllocationBasis.WEIGHT),
  estimatedUsd: z.coerce.number().min(0).default(0),
  notes: z.string().trim().optional().or(z.literal('')),
})

function revalidateShipment(id?: string) {
  revalidatePath('/shipments')
  if (id) revalidatePath(`/shipments/${id}`)
  revalidatePath('/purchases')
  revalidatePath('/inventory')
  revalidatePath('/products')
}

export async function createShipment(formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = shipmentSchema.safeParse({
    code: formData.get('code'),
    courier: formData.get('courier'),
    basis: formData.get('basis') ?? undefined,
    estimatedUsd: formData.get('estimatedUsd') ?? undefined,
    notes: formData.get('notes'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const clash = await prisma.shipment.findUnique({ where: { code: parsed.data.code } })
  if (clash) return { ok: false, error: `Shipment "${parsed.data.code}" already exists` }

  await prisma.shipment.create({
    data: {
      code: parsed.data.code,
      courier: parsed.data.courier || null,
      basis: parsed.data.basis,
      estimatedUsd: parsed.data.estimatedUsd,
      notes: parsed.data.notes || null,
    },
  })

  revalidateShipment()
  return { ok: true }
}

export async function updateShipment(id: string, formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = shipmentSchema.partial().safeParse({
    code: formData.get('code') ?? undefined,
    courier: formData.get('courier') ?? undefined,
    basis: formData.get('basis') ?? undefined,
    estimatedUsd: formData.get('estimatedUsd') ?? undefined,
    notes: formData.get('notes') ?? undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const current = await prisma.shipment.findUnique({ where: { id } })
  if (!current) return { ok: false, error: 'Shipment not found' }

  if (parsed.data.code && parsed.data.code !== current.code) {
    const clash = await prisma.shipment.findUnique({ where: { code: parsed.data.code } })
    if (clash) return { ok: false, error: `Shipment "${parsed.data.code}" already exists` }
  }

  await prisma.shipment.update({
    where: { id },
    data: {
      ...(parsed.data.code ? { code: parsed.data.code } : {}),
      ...(parsed.data.courier !== undefined ? { courier: parsed.data.courier || null } : {}),
      ...(parsed.data.basis ? { basis: parsed.data.basis } : {}),
      ...(parsed.data.estimatedUsd !== undefined
        ? { estimatedUsd: parsed.data.estimatedUsd }
        : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
    },
  })

  revalidateShipment(id)
  return { ok: true }
}

/**
 * Moves a shipment along its journey, dragging its batches' status with it.
 * COSTED is not settable here — it is the result of `costShipment`, since a
 * shipment is only "costed" once the bill has actually been allocated.
 */
export async function updateShipmentStatus(
  id: string,
  status: ShipmentStatus
): Promise<ActionResult> {
  await requireUser()
  if (status === ShipmentStatus.COSTED) {
    return { ok: false, error: 'Enter the freight bill to mark a shipment costed' }
  }

  const shipment = await prisma.shipment.findUnique({ where: { id } })
  if (!shipment) return { ok: false, error: 'Shipment not found' }

  const batchStatus = SHIPMENT_TO_BATCH_STATUS[status]

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id },
      data: {
        status,
        ...(status === ShipmentStatus.IN_TRANSIT && !shipment.departedAt
          ? { departedAt: new Date() }
          : {}),
        ...(status === ShipmentStatus.ARRIVED && !shipment.arrivedAt
          ? { arrivedAt: new Date() }
          : {}),
      },
    })
    await tx.inventoryBatch.updateMany({
      where: { shipmentId: id },
      data: { status: batchStatus },
    })
    const batches = await tx.inventoryBatch.findMany({
      where: { shipmentId: id },
      select: { productId: true, purchaseId: true },
    })
    const purchaseIds = batches.map((b) => b.purchaseId).filter((p): p is string => !!p)
    if (purchaseIds.length > 0) {
      await tx.purchase.updateMany({
        where: { id: { in: purchaseIds } },
        data: { status: batchStatus as unknown as PurchaseStatus },
      })
    }
    // Moving in or out of the on-hand set changes which batches count.
    for (const productId of new Set(batches.map((b) => b.productId))) {
      await recomputeAverageCost(tx, productId)
    }
  })

  revalidateShipment(id)
  return { ok: true }
}

/** Puts a set of batches in (or, with `shipmentId: null`, out of) a shipment. */
export async function assignBatches(
  batchIds: string[],
  shipmentId: string | null
): Promise<ActionResult> {
  await requireUser()
  if (batchIds.length === 0) return { ok: false, error: 'Select at least one purchase' }

  if (shipmentId) {
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } })
    if (!shipment) return { ok: false, error: 'Shipment not found' }
    if (shipment.status === ShipmentStatus.COSTED) {
      return { ok: false, error: 'That shipment is already costed — reopen it to change what is inside' }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.inventoryBatch.updateMany({
      where: { id: { in: batchIds } },
      data: { shipmentId },
    })
    if (shipmentId) {
      const shipment = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
      const batchStatus = SHIPMENT_TO_BATCH_STATUS[shipment.status]
      await tx.inventoryBatch.updateMany({
        where: { id: { in: batchIds } },
        data: { status: batchStatus },
      })
    }
  })

  revalidateShipment(shipmentId ?? undefined)
  return { ok: true }
}

const costingSchema = z.object({
  freightUsd: z.coerce.number().min(0).default(0),
  customsUsd: z.coerce.number().min(0).default(0),
  otherUsd: z.coerce.number().min(0).default(0),
  /** Domestic delivery, in pesos — converted server-side at the Saldo rate. */
  localShippingArs: z.coerce.number().min(0).default(0),
  basis: z.nativeEnum(AllocationBasis).optional(),
})

export type CostShipmentResult =
  | { ok: true; summary: CostingSummary }
  | { ok: false; error: string }

/**
 * The arrival step: records the actual courier bill, splits it across the
 * batches in the box, and moves them to WAREHOUSE at their true landed cost.
 * This is the moment the goods become sellable, which is why the cost is
 * correct before FIFO can ever touch it.
 *
 * Local delivery is billed in pesos, so it is converted here — server-side, at
 * the live Saldo rate — and the rate is stored on the shipment so the result
 * stays reproducible if the shipment is reopened later.
 */
export async function costShipment(
  id: string,
  input: z.input<typeof costingSchema>
): Promise<CostShipmentResult> {
  await requireUser()
  const parsed = costingSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: { _count: { select: { batches: true } } },
  })
  if (!shipment) return { ok: false, error: 'Shipment not found' }
  if (shipment._count.batches === 0) {
    return { ok: false, error: 'This shipment has no purchases in it yet' }
  }

  const { freightUsd, customsUsd, otherUsd, localShippingArs, basis } = parsed.data
  if (freightUsd + customsUsd + otherUsd + localShippingArs <= 0) {
    return { ok: false, error: 'Enter at least one cost before closing the shipment' }
  }

  // Rate is read once, here, and frozen on the shipment — not read again inside
  // the transaction, so the stored USD and the stored rate always agree.
  const usdArsRate = await getUsdArsRate()
  const localShippingUsd = arsToUsd(localShippingArs, usdArsRate)

  let summary: CostingSummary
  try {
    summary = await prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id },
        data: {
          freightUsd,
          customsUsd,
          otherUsd,
          localShippingArs,
          localShippingUsd,
          localShippingRate: localShippingArs > 0 ? usdArsRate : null,
          ...(basis ? { basis } : {}),
          arrivedAt: shipment.arrivedAt ?? new Date(),
        },
      })
      return applyShipmentCosting(tx, id, 'actual')
    })
  } catch (err) {
    console.error('[shipment costing] failed:', err)
    return { ok: false, error: 'Could not apply the freight costs' }
  }

  await sendTelegramMessage(
    shipmentCostedMessage({
      code: shipment.code,
      totalBillUsd: summary.totalBillUsd,
      batchCount: summary.batchCount,
      productCount: summary.productCount,
    })
  )

  revalidateShipment(id)
  return { ok: true, summary }
}

/** Re-spreads the current estimate over the batches, without closing anything. */
export async function applyEstimate(id: string): Promise<CostShipmentResult> {
  await requireUser()
  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: { _count: { select: { batches: true } } },
  })
  if (!shipment) return { ok: false, error: 'Shipment not found' }
  if (shipment._count.batches === 0) {
    return { ok: false, error: 'This shipment has no purchases in it yet' }
  }
  if (shipment.estimatedUsd <= 0) {
    return { ok: false, error: 'Set an estimated freight cost first' }
  }
  if (shipment.status === ShipmentStatus.COSTED) {
    return { ok: false, error: 'This shipment is already costed with its actual bill' }
  }

  const summary = await prisma.$transaction((tx) => applyShipmentCosting(tx, id, 'estimate'))
  revalidateShipment(id)
  return { ok: true, summary }
}

/**
 * Reopens a costed shipment so the bill can be corrected. Landed costs stay as
 * they are until it is costed again — reopening is about editing, not undoing.
 */
export async function reopenShipment(id: string): Promise<ActionResult> {
  await requireUser()
  const shipment = await prisma.shipment.findUnique({ where: { id } })
  if (!shipment) return { ok: false, error: 'Shipment not found' }
  if (shipment.status !== ShipmentStatus.COSTED) {
    return { ok: false, error: 'Only a costed shipment can be reopened' }
  }

  await prisma.shipment.update({
    where: { id },
    data: { status: ShipmentStatus.ARRIVED, costedAt: null },
  })

  revalidateShipment(id)
  return { ok: true }
}

export async function deleteShipment(id: string): Promise<ActionResult> {
  await requireUser()
  const shipment = await prisma.shipment.findUnique({ where: { id } })
  if (!shipment) return { ok: false, error: 'Shipment not found' }
  if (shipment.status === ShipmentStatus.COSTED) {
    return { ok: false, error: 'A costed shipment cannot be deleted' }
  }

  // Batches survive with `shipmentId: null` (onDelete: SetNull) — deleting a
  // box must never delete the goods that were in it.
  await prisma.shipment.delete({ where: { id } })
  revalidateShipment()
  return { ok: true }
}

/**
 * Batches not yet in any shipment — the pool the assign picker draws from.
 * Anything still in transit qualifies, including purchases registered before
 * shipments existed, so they can be pulled into a box retroactively.
 */
export async function getUnassignedBatches() {
  await requireUser()
  return prisma.inventoryBatch.findMany({
    where: {
      shipmentId: null,
      status: { in: IN_TRANSIT_STATUSES },
      remainingQuantity: { gt: 0 },
    },
    include: { product: { select: { name: true, sku: true } } },
    orderBy: { purchasedAt: 'desc' },
    take: 200,
  })
}
