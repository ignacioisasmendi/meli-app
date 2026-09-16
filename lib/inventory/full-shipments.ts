import 'server-only'
import { format } from 'date-fns'
import { Prisma, FullShipmentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
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
      shipments: { include: { batches: { select: { productId: true } } } },
    },
  })

  let received = 0
  for (const fs of pending) {
    const productIds = [...new Set(fs.shipments.flatMap((s) => s.batches.map((b) => b.productId)))]
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
        shipmentCount: fs.shipments.length,
      })
    )
  }

  return { checked: pending.length, received }
}

// ── Reads ────────────────────────────────────────────────────────────────

export const fullShipmentWithDetail = {
  account: { select: { id: true, nickname: true } },
  shipments: {
    include: {
      batches: {
        include: { product: { select: { id: true, name: true, sku: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.FullShipmentInclude

export type FullShipmentWithDetail = Prisma.FullShipmentGetPayload<{
  include: typeof fullShipmentWithDetail
}>

export function getFullShipment(id: string) {
  return prisma.fullShipment.findUnique({ where: { id }, include: fullShipmentWithDetail })
}
