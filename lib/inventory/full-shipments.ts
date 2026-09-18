import 'server-only'
import { format } from 'date-fns'
import { Prisma, FullShipmentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AT_DEPOT_WHERE, PLACED_IN_FULL_WHERE } from '@/lib/inventory/stock'
import { splitBatch } from '@/lib/inventory/split'
import { getItem, searchFulfillmentOperations } from '@/lib/mercadolibre/client'
import { sendTelegramMessage } from '@/lib/telegram/client'
import { fullShipmentReceivedMessage } from '@/lib/telegram/messages'

function toMlDate(date: Date): string {
  return format(date, 'yyyyMMdd')
}

/**
 * Resolves each product's Full inventory_id for `accountId`, fetching and
 * caching it on `MlListing` the first time it's needed (`inventory_id` is
 * otherwise only visible on the item resource, not anywhere already synced).
 * Products with no listing on this account are skipped — they can't have Full
 * stock there.
 */
async function resolveInventoryIds(accountId: string, productIds: string[]): Promise<string[]> {
  const [account, listings] = await Promise.all([
    prisma.mercadoLibreAccount.findUniqueOrThrow({ where: { id: accountId } }),
    prisma.mlListing.findMany({ where: { accountId, productId: { in: productIds } } }),
  ])

  const inventoryIds: string[] = []
  for (const listing of listings) {
    if (listing.inventoryId) {
      inventoryIds.push(listing.inventoryId)
      continue
    }
    try {
      const item = await getItem(account, listing.mlItemId)
      if (!item.inventoryId) continue
      await prisma.mlListing.update({
        where: { id: listing.id },
        data: { inventoryId: item.inventoryId },
      })
      inventoryIds.push(item.inventoryId)
    } catch (err) {
      console.error(
        `[full-shipments] could not resolve inventory_id for listing ${listing.id}:`,
        err
      )
    }
  }
  return inventoryIds
}

export interface FullShipmentSyncSummary {
  checked: number
  received: number
}

/**
 * Polls ML for every SENT Full shipment and flips it to RECEIVED once an
 * INBOUND_RECEPTION operation shows up carrying its `mlInboundId`. Meant to
 * run a few times a day off a cron — there is no webhook for this.
 */
export async function syncFullShipmentReceptions(): Promise<FullShipmentSyncSummary> {
  const pending = await prisma.fullShipment.findMany({
    where: { status: FullShipmentStatus.SENT },
    include: {
      account: true,
      batches: { select: { productId: true, quantity: true } },
    },
  })

  let received = 0
  for (const fs of pending) {
    const productIds = [...new Set(fs.batches.map((b) => b.productId))]
    if (productIds.length === 0) continue

    const inventoryIds = await resolveInventoryIds(fs.accountId, productIds)
    if (inventoryIds.length === 0) continue

    let search
    try {
      search = await searchFulfillmentOperations(fs.account, {
        inventoryIds,
        type: 'INBOUND_RECEPTION',
        dateFrom: toMlDate(fs.sentAt),
        dateTo: toMlDate(new Date()),
      })
    } catch (err) {
      console.error(`[full-shipments] operations search failed for ${fs.id}:`, err)
      continue
    }

    const match = search.results.find((op) =>
      op.external_references?.some((r) => r.type === 'inbound_id' && r.value === fs.mlInboundId)
    )
    if (!match) continue

    await prisma.fullShipment.update({
      where: { id: fs.id },
      data: { status: FullShipmentStatus.RECEIVED, receivedAt: new Date(match.date_created) },
    })
    received++

    await sendTelegramMessage(
      fullShipmentReceivedMessage({
        mlInboundId: fs.mlInboundId,
        accountNickname: fs.account.nickname,
        productCount: productIds.length,
        units: fs.batches.reduce((n, b) => n + b.quantity, 0),
      })
    )
  }

  return { checked: pending.length, received }
}

// ── Allocation ───────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient

export interface FullLineInput {
  productId: string
  quantity: number
}

/**
 * Received batches of a product that can still go to Full, oldest first — the
 * same order FIFO sells them in, so the units shipped are the ones that would
 * otherwise sell next from the depot.
 */
function receivedBatches(client: Tx | typeof prisma, productIds?: string[]) {
  return client.inventoryBatch.findMany({
    where: {
      ...(productIds ? { productId: { in: productIds } } : {}),
      ...AT_DEPOT_WHERE,
      remainingQuantity: { gt: 0 },
    },
    orderBy: { purchasedAt: 'asc' },
  })
}

/**
 * Moves `quantity` received units of each product into a Full box. Batches are
 * taken whole while they fit and split for the last partial one (`splitBatch`),
 * so a Full batch's `quantity` is always exactly what went into the box.
 */
export async function allocateToFull(tx: Tx, fullShipmentId: string, lines: FullLineInput[]) {
  const wanted = lines.filter((l) => l.quantity > 0)
  const batches = await receivedBatches(
    tx,
    wanted.map((l) => l.productId)
  )

  for (const line of wanted) {
    let remaining = line.quantity
    for (const batch of batches.filter((b) => b.productId === line.productId)) {
      if (remaining <= 0) break
      const take = Math.min(remaining, batch.remainingQuantity)
      remaining -= take
      if (take === batch.quantity) {
        await tx.inventoryBatch.update({ where: { id: batch.id }, data: { fullShipmentId } })
      } else {
        await splitBatch(tx, batch, take, { fullShipmentId })
      }
    }
    if (remaining > 0) {
      throw new Error(`Not enough received stock: ${remaining} unit(s) short for one product`)
    }
  }
}

/**
 * Moves `quantity` on-hand units of a product into Full (or back to the depot)
 * without a Full box — for stock that is already there. Takes the oldest batches
 * first, like `allocateToFull`, splitting the last one when only part of it
 * moves. Only batches placed by hand come back: a Full box's units follow the box.
 */
export async function placeInFull(
  tx: Tx,
  params: { productId: string; quantity: number; toFull: boolean }
) {
  const batches = await tx.inventoryBatch.findMany({
    where: {
      productId: params.productId,
      ...(params.toFull ? AT_DEPOT_WHERE : PLACED_IN_FULL_WHERE),
      remainingQuantity: { gt: 0 },
    },
    orderBy: { purchasedAt: 'asc' },
  })
  let remaining = params.quantity
  for (const batch of batches) {
    if (remaining <= 0) break
    const take = Math.min(remaining, batch.remainingQuantity)
    remaining -= take
    // A batch with sales on it has quantity > remaining; its sold units can't
    // move, so only a batch whose every unit moves is flipped in place.
    if (take === batch.quantity) {
      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: { placedInFull: params.toFull },
      })
    } else {
      await splitBatch(tx, batch, take, { placedInFull: params.toFull })
    }
  }
  if (remaining > 0) {
    throw new Error(`Only ${params.quantity - remaining} unit(s) can be moved`)
  }
}

export interface ReceivedProduct {
  productId: string
  name: string
  sku: string
  imageUrl: string | null
  /** Units on hand at the depot that no Full box has taken yet. */
  quantity: number
}

/** Received stock per product — what a Full box can be filled from. */
export async function listReceivedStock(): Promise<ReceivedProduct[]> {
  const batches = await prisma.inventoryBatch.findMany({
    where: { ...AT_DEPOT_WHERE, remainingQuantity: { gt: 0 } },
    select: {
      remainingQuantity: true,
      product: { select: { id: true, name: true, sku: true, imageUrl: true } },
    },
  })
  const byProduct = new Map<string, ReceivedProduct>()
  for (const b of batches) {
    const row = byProduct.get(b.product.id)
    if (row) row.quantity += b.remainingQuantity
    else
      byProduct.set(b.product.id, {
        productId: b.product.id,
        name: b.product.name,
        sku: b.product.sku,
        imageUrl: b.product.imageUrl,
        quantity: b.remainingQuantity,
      })
  }
  return [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ── Reads ────────────────────────────────────────────────────────────────

export const fullShipmentWithDetail = {
  account: { select: { id: true, nickname: true } },
  batches: {
    include: {
      product: { select: { id: true, name: true, sku: true, imageUrl: true } },
      shipment: { select: { id: true, code: true } },
    },
    orderBy: { purchasedAt: 'asc' },
  },
} satisfies Prisma.FullShipmentInclude

export type FullShipmentWithDetail = Prisma.FullShipmentGetPayload<{
  include: typeof fullShipmentWithDetail
}>

export function getFullShipment(id: string) {
  return prisma.fullShipment.findUnique({ where: { id }, include: fullShipmentWithDetail })
}
