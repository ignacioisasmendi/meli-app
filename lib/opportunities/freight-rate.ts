/**
 * The USA → Argentina freight rate we actually pay, measured from shipments
 * that have already been costed.
 *
 * A scan that assumes a round "USD 60/kg" is guessing at the single biggest
 * variable cost in the business, when the answer is already in the database:
 * every `COSTED` shipment knows its full bill (`shipmentBill`) and the batches
 * inside it know their weight.
 *
 * A shipment only counts if EVERY batch in it has a weight on file. Including a
 * partial one would understate the kilos while keeping the whole bill, inflating
 * the rate — the same reasoning that makes `resolveBasis` refuse a WEIGHT split
 * when a weight is missing.
 */

import type { PrismaClient } from '@prisma/client'
import { shipmentBill } from '@/lib/inventory/shipment'

/** Last-resort rate when nothing has been costed yet. */
export const DEFAULT_FREIGHT_USD_PER_KG = 60

const FREIGHT_RATE_KEY = 'freightUsdPerKg' // manual override / fallback

export interface FreightRate {
  usdPerKg: number
  /** MEASURED from costed shipments, or a FALLBACK setting/constant. */
  basis: 'MEASURED' | 'FALLBACK'
  shipmentsUsed: number
  /** Costed shipments skipped because a batch had no weight on file. */
  shipmentsSkipped: number
  totalKg: number
  totalBillUsd: number
}

/**
 * Weighted average USD/kg over the most recent costed shipments.
 *
 * Weighted, not an average of per-shipment rates: a 40 kg box and a 2 kg box
 * are not equal evidence about what the next kilo will cost.
 */
export async function getFreightUsdPerKg(
  prisma: PrismaClient,
  sampleSize = 10
): Promise<FreightRate> {
  const shipments = await prisma.shipment.findMany({
    where: { costedAt: { not: null } },
    orderBy: { costedAt: 'desc' },
    take: sampleSize,
    include: {
      batches: {
        select: {
          quantity: true,
          product: { select: { weightGrams: true } },
        },
      },
    },
  })

  let totalBillUsd = 0
  let totalKg = 0
  let shipmentsUsed = 0
  let shipmentsSkipped = 0

  for (const shipment of shipments) {
    if (shipment.batches.length === 0) continue

    const missingWeight = shipment.batches.some(
      (b) => b.product.weightGrams == null || b.product.weightGrams <= 0
    )
    if (missingWeight) {
      shipmentsSkipped++
      continue
    }

    const kg = shipment.batches.reduce(
      (sum, b) => sum + (Math.max(0, b.quantity) * (b.product.weightGrams ?? 0)) / 1000,
      0
    )
    const bill = shipmentBill(shipment)
    if (kg <= 0 || bill <= 0) {
      shipmentsSkipped++
      continue
    }

    totalKg += kg
    totalBillUsd += bill
    shipmentsUsed++
  }

  if (shipmentsUsed > 0 && totalKg > 0) {
    return {
      usdPerKg: Math.round((totalBillUsd / totalKg) * 100) / 100,
      basis: 'MEASURED',
      shipmentsUsed,
      shipmentsSkipped,
      totalKg: Math.round(totalKg * 100) / 100,
      totalBillUsd: Math.round(totalBillUsd * 100) / 100,
    }
  }

  const setting = await prisma.setting.findUnique({ where: { key: FREIGHT_RATE_KEY } })
  const override = Number(setting?.value)
  const envRate = Number(process.env.FREIGHT_USD_PER_KG)

  const usdPerKg =
    Number.isFinite(override) && override > 0
      ? override
      : Number.isFinite(envRate) && envRate > 0
        ? envRate
        : DEFAULT_FREIGHT_USD_PER_KG

  return {
    usdPerKg,
    basis: 'FALLBACK',
    shipmentsUsed: 0,
    shipmentsSkipped,
    totalKg: 0,
    totalBillUsd: 0,
  }
}
