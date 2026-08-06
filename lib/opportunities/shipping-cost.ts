/**
 * The free-shipping subsidy the SELLER absorbs on a Mercado Libre sale — the
 * cost a percentage-only margin model cannot see, and the one that decides
 * whether a heavy product is worth importing at all.
 *
 * It cannot be read from `Sale.shippingArs`: that field mirrors
 * `payments[].shipping_cost`, which is what the BUYER paid, and it is 0 on every
 * free-shipping order (confirmed 45/45 on this account). The seller's own charge
 * lives in `/shipments/{id}/costs`:
 *
 *   { gross_amount: 24200,
 *     receiver: { cost: 0 },                       ← buyer pays nothing
 *     senders: [{ cost: 6080,                      ← what WE pay
 *                 discounts: [{ rate: 0.5, type: 'mandatory' }] }] }
 *
 * So the rate is measured from our own shipping history rather than assumed from
 * a published table: sampling real sales captures the mandatory ML discount, our
 * reputation tier and the actual buyer mix, none of which a generic bracket
 * table would get right.
 */

import type { PrismaClient } from '@prisma/client'

const ML_API_BASE = 'https://api.mercadolibre.com'

/** Setting key holding the measured table, as JSON. */
export const SHIPPING_BRACKETS_KEY = 'mlSellerShippingBrackets'

/**
 * ML's own weight tiers. Shipping is a step function of weight, so a single
 * ARS/kg figure would overcharge light products and undercharge heavy ones.
 */
export const WEIGHT_BRACKETS_GRAMS = [500, 1000, 2000, 5000, 10000, 25000] as const

export interface ShippingBracket {
  /** Upper bound of the bracket in grams; `null` is the open-ended top one. */
  maxGrams: number | null
  /** Median ARS the seller paid for shipments in this bracket. */
  arsPerShipment: number
  /** How many observed shipments back this figure. */
  samples: number
}

export interface ShippingTable {
  brackets: ShippingBracket[]
  measuredAt: string
  /** Sales inspected to build the table. */
  sampled: number
}

export interface ShippingCost {
  ars: number
  basis: 'MEASURED' | 'EXTRAPOLATED' | 'UNKNOWN'
  /** Samples behind the bracket that produced this figure. */
  samples: number
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

const bracketIndex = (grams: number): number => {
  const i = WEIGHT_BRACKETS_GRAMS.findIndex((max) => grams <= max)
  return i === -1 ? WEIGHT_BRACKETS_GRAMS.length : i
}

/**
 * Looks a weight up in a measured table.
 *
 * An empty bracket borrows from the nearest HEAVIER one that has data, never a
 * lighter one — guessing high on shipping kills a marginal product, guessing low
 * ships a loss.
 */
export function lookupShippingCost(
  table: ShippingTable | null,
  weightGrams: number
): ShippingCost {
  if (!table || table.brackets.length === 0) {
    return { ars: 0, basis: 'UNKNOWN', samples: 0 }
  }

  const want = bracketIndex(Math.max(0, weightGrams))
  const exact = table.brackets[want]
  if (exact && exact.samples > 0) {
    return { ars: Math.round(exact.arsPerShipment), basis: 'MEASURED', samples: exact.samples }
  }

  for (let i = want + 1; i < table.brackets.length; i++) {
    const b = table.brackets[i]
    if (b?.samples > 0) {
      return { ars: Math.round(b.arsPerShipment), basis: 'EXTRAPOLATED', samples: b.samples }
    }
  }
  for (let i = want - 1; i >= 0; i--) {
    const b = table.brackets[i]
    if (b?.samples > 0) {
      return { ars: Math.round(b.arsPerShipment), basis: 'EXTRAPOLATED', samples: b.samples }
    }
  }

  return { ars: 0, basis: 'UNKNOWN', samples: 0 }
}

/** Reads the last measured table out of `Setting`. */
export async function readShippingTable(prisma: PrismaClient): Promise<ShippingTable | null> {
  const setting = await prisma.setting.findUnique({ where: { key: SHIPPING_BRACKETS_KEY } })
  if (!setting) return null
  try {
    return JSON.parse(setting.value) as ShippingTable
  } catch {
    return null
  }
}

/**
 * Samples recent sales, reads what we were charged for each shipment, and
 * rebuilds the bracket table. Costs two ML calls per sale, so it is meant to run
 * occasionally (a cron, or by hand) rather than inside a scan.
 */
export async function measureShippingTable(
  prisma: PrismaClient,
  accessToken: string,
  sampleSize = 60
): Promise<ShippingTable> {
  const sales = await prisma.sale.findMany({
    where: { product: { weightGrams: { gt: 0 } } },
    orderBy: { soldAt: 'desc' },
    take: sampleSize,
    select: {
      mlOrderId: true,
      quantity: true,
      product: { select: { weightGrams: true } },
    },
  })

  const observations = new Map<number, number[]>()
  let sampled = 0

  for (const sale of sales) {
    const senderCost = await fetchSenderCost(accessToken, sale.mlOrderId)
    if (senderCost == null) continue

    // Weight of what actually travelled in that parcel.
    const grams = (sale.product.weightGrams ?? 0) * Math.max(1, sale.quantity)
    if (grams <= 0) continue

    const index = bracketIndex(grams)
    const bucket = observations.get(index) ?? []
    bucket.push(senderCost)
    observations.set(index, bucket)
    sampled++
  }

  const brackets: ShippingBracket[] = [...WEIGHT_BRACKETS_GRAMS, null].map((maxGrams, i) => {
    const values = observations.get(i) ?? []
    return {
      maxGrams,
      arsPerShipment: Math.round(median(values)),
      samples: values.length,
    }
  })

  const table: ShippingTable = {
    brackets,
    measuredAt: new Date().toISOString(),
    sampled,
  }

  await prisma.setting.upsert({
    where: { key: SHIPPING_BRACKETS_KEY },
    update: { value: JSON.stringify(table) },
    create: { key: SHIPPING_BRACKETS_KEY, value: JSON.stringify(table) },
  })

  return table
}

/** What we were charged to ship one order, or null when it can't be read. */
async function fetchSenderCost(
  accessToken: string,
  mlOrderId: string
): Promise<number | null> {
  try {
    const headers = { Authorization: `Bearer ${accessToken}` }

    const orderRes = await fetch(`${ML_API_BASE}/orders/${mlOrderId}`, {
      headers,
      cache: 'no-store',
    })
    if (!orderRes.ok) return null
    const order = (await orderRes.json()) as { shipping?: { id?: number } }
    const shipmentId = order.shipping?.id
    if (!shipmentId) return null

    const costRes = await fetch(`${ML_API_BASE}/shipments/${shipmentId}/costs`, {
      headers,
      cache: 'no-store',
    })
    if (!costRes.ok) return null
    const costs = (await costRes.json()) as {
      senders?: Array<{ cost?: number }>
    }

    const cost = costs.senders?.reduce((sum, s) => sum + Math.max(0, s.cost ?? 0), 0)
    return typeof cost === 'number' && cost > 0 ? cost : null
  } catch {
    return null
  }
}
