import 'server-only'
import type { MercadoLibreAccount } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { applySale } from '@/lib/inventory/stock'
import { checkLowStock } from '@/lib/inventory/alerts'
import { computeProfitWithRate } from '@/lib/inventory/profit'
import { getInTransit, stockViewFrom } from '@/lib/inventory/stock'
import { sendTelegramMessage } from '@/lib/telegram/client'
import { newSaleMessage } from '@/lib/telegram/messages'
import { getOrder, getItem, getSellerItemIds, type MlOrder } from '@/lib/mercadolibre/client'

/**
 * Imports the account's listings and upserts MlListing rows. Auto-links a
 * listing to a Product when its seller SKU matches a known product SKU.
 */
export async function syncAccountListings(account: MercadoLibreAccount): Promise<number> {
  let offset = 0
  let total = Infinity
  let imported = 0

  while (offset < total) {
    const page = await getSellerItemIds(account, offset, 50)
    total = page.paging.total
    if (page.results.length === 0) break

    for (const itemId of page.results) {
      const item = await getItem(account, itemId)
      const sku = item.seller_custom_field ?? null
      const product = sku
        ? await prisma.product.findUnique({ where: { sku } })
        : null

      await prisma.mlListing.upsert({
        where: { accountId_mlItemId: { accountId: account.id, mlItemId: itemId } },
        update: { title: item.title, sku, ...(product ? { productId: product.id } : {}) },
        create: {
          accountId: account.id,
          mlItemId: itemId,
          title: item.title,
          sku,
          productId: product?.id ?? null,
        },
      })
      imported++
    }
    offset += page.results.length
  }
  return imported
}

/** Resolves the internal product for an ML item on a given account, if linked. */
async function resolveProductId(accountId: string, mlItemId: string): Promise<string | null> {
  const listing = await prisma.mlListing.findUnique({
    where: { accountId_mlItemId: { accountId, mlItemId } },
    select: { productId: true },
  })
  return listing?.productId ?? null
}

/**
 * Processes an ML order: creates a Sale (idempotent on mlOrderId), decrements
 * stock FIFO, computes profit, and notifies via Telegram. Returns a short status.
 *
 * MVP scope: handles the first mapped order item (these sellers ship one SKU per
 * order); additional line items are ignored and logged.
 */
export async function processOrder(
  account: MercadoLibreAccount,
  orderId: string
): Promise<{ status: 'created' | 'skipped'; reason?: string }> {
  const order: MlOrder = await getOrder(account, orderId)
  const mlOrderId = String(order.id)

  if (order.status === 'cancelled') return { status: 'skipped', reason: 'cancelled' }

  const existing = await prisma.sale.findUnique({ where: { mlOrderId } })
  if (existing) return { status: 'skipped', reason: 'duplicate' }

  const line = order.order_items[0]
  if (!line) return { status: 'skipped', reason: 'no_items' }

  const productId = await resolveProductId(account.id, line.item.id)
  if (!productId) {
    // Record the listing so the user can map it, then skip stock changes.
    await prisma.mlListing.upsert({
      where: { accountId_mlItemId: { accountId: account.id, mlItemId: line.item.id } },
      update: { title: line.item.title, sku: line.item.seller_sku ?? null },
      create: {
        accountId: account.id,
        mlItemId: line.item.id,
        title: line.item.title,
        sku: line.item.seller_sku ?? null,
      },
    })
    return { status: 'skipped', reason: 'unmapped_item' }
  }

  const quantity = line.quantity
  const salePriceArs = line.unit_price * quantity
  const feeArs = (line.sale_fee ?? 0) * quantity
  const shippingArs = (order.payments ?? []).reduce((s, p) => s + (p.shipping_cost ?? 0), 0)
  const soldAt = new Date(order.date_closed ?? order.date_created)

  // Stock + sale row in one transaction; profit is computed from FIFO cost.
  const { saleId, costUsd } = await prisma.$transaction(async (tx) => {
    const { costUsd } = await applySale(tx, { productId, quantity, referenceId: mlOrderId })
    const sale = await tx.sale.create({
      data: {
        mlOrderId,
        accountId: account.id,
        productId,
        quantity,
        salePriceArs,
        feeArs,
        shippingArs,
        profitUsd: 0, // set below once rate is known
        soldAt,
      },
    })
    return { saleId: sale.id, costUsd }
  })

  const profit = await computeProfitWithRate({ salePriceArs, feeArs, shippingArs, costUsd })
  await prisma.sale.update({ where: { id: saleId }, data: { profitUsd: profit.profitUsd } })

  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } })
  const view = stockViewFrom(product, await getInTransit(productId))

  await sendTelegramMessage(
    newSaleMessage({
      productName: product.name,
      quantity,
      accountNickname: account.nickname,
      priceArs: salePriceArs,
      remainingStock: view.available,
    })
  )
  await checkLowStock(productId)

  return { status: 'created' }
}
