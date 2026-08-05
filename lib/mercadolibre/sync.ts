import 'server-only'
import type { MercadoLibreAccount } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { applySale, recordSaleConsumption } from '@/lib/inventory/stock'
import { checkLowStock } from '@/lib/inventory/alerts'
import { computeProfitWithRate } from '@/lib/inventory/profit'
import { getInTransit, stockViewFrom } from '@/lib/inventory/stock'
import { cancelSale, openReturn, refundWithoutReturn } from '@/lib/inventory/returns'
import { sendTelegramMessage } from '@/lib/telegram/client'
import {
  newSaleMessage,
  unmappedSaleMessage,
  saleCancelledMessage,
  returnOpenedMessage,
} from '@/lib/telegram/messages'
import {
  getOrder,
  getItem,
  getSellerItemIds,
  getClaim,
  getClaimExpectedResolutions,
  orderStatusDetail,
  type MlOrder,
} from '@/lib/mercadolibre/client'

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

      // Borrow the listing's picture so the product is recognisable at a glance.
      // Scoped to `imageUrl: null` so re-syncing can't overwrite an image that
      // was set deliberately, and so a product with several listings keeps the
      // first picture it got rather than flip-flopping between them.
      if (product && !product.imageUrl && item.imageUrl) {
        await prisma.product.updateMany({
          where: { id: product.id, imageUrl: null },
          data: { imageUrl: item.imageUrl },
        })
      }
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
 * Also the cancellation path: ML re-notifies the same order resource when it is
 * cancelled, so an order we've already sold gets reversed here rather than
 * dismissed as a duplicate.
 *
 * MVP scope: handles the first mapped order item (these sellers ship one SKU per
 * order); additional line items are ignored and logged.
 */
export async function processOrder(
  account: MercadoLibreAccount,
  orderId: string
): Promise<{ status: 'created' | 'cancelled' | 'skipped'; reason?: string }> {
  const order: MlOrder = await getOrder(account, orderId)
  const mlOrderId = String(order.id)
  const cancelled = order.status === 'cancelled'

  const existing = await prisma.sale.findUnique({ where: { mlOrderId } })

  if (existing) {
    if (!cancelled) return { status: 'skipped', reason: 'duplicate' }

    const result = await cancelSale({
      saleId: existing.id,
      reason: orderStatusDetail(order) ?? 'Cancelled on Mercado Libre',
    })
    if (result.status === 'noop') return { status: 'skipped', reason: result.reason }

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: existing.productId },
    })
    await sendTelegramMessage(
      saleCancelledMessage({
        productName: product.name,
        quantity: result.quantity,
        accountNickname: account.nickname,
        refundedArs: existing.salePriceArs * (result.quantity / existing.quantity),
        reason: orderStatusDetail(order),
        restocked: true,
      })
    )
    return { status: 'cancelled' }
  }

  // Cancelled before we ever recorded it — nothing to reverse.
  if (cancelled) return { status: 'skipped', reason: 'cancelled' }

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
    // Stock/profit can't be recorded for an unmapped item, but the sale still
    // happened — alert so it isn't missed silently.
    await sendTelegramMessage(
      unmappedSaleMessage({
        listingTitle: line.item.title,
        accountNickname: account.nickname,
        priceArs: line.unit_price * line.quantity,
        mlItemId: line.item.id,
      })
    )
    return { status: 'skipped', reason: 'unmapped_item' }
  }

  const quantity = line.quantity
  const salePriceArs = line.unit_price * quantity
  const feeArs = (line.sale_fee ?? 0) * quantity
  const shippingArs = (order.payments ?? []).reduce((s, p) => s + (p.shipping_cost ?? 0), 0)
  const soldAt = new Date(order.date_closed ?? order.date_created)

  // Stock + sale row in one transaction; profit is computed from FIFO cost.
  const { saleId, costUsd } = await prisma.$transaction(async (tx) => {
    const { costUsd, consumption } = await applySale(tx, {
      productId,
      quantity,
      referenceId: mlOrderId,
    })
    const sale = await tx.sale.create({
      data: {
        mlOrderId,
        accountId: account.id,
        productId,
        quantity,
        salePriceArs,
        feeArs,
        shippingArs,
        costUsd,
        profitUsd: 0, // set below once rate is known
        soldAt,
      },
    })
    // Remember which batches paid for this sale, so a later return can credit
    // them back at the cost the units left at.
    await recordSaleConsumption(tx, sale.id, consumption)
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

/** Claim types that mean the sale is being unwound rather than just discussed. */
const REVERSING_CLAIM_TYPES = new Set(['return', 'cancel_sale', 'cancel_purchase', 'change'])

/** Resolutions where physical goods come back to us. */
const GOODS_RETURNING_RESOLUTIONS = new Set(['return_product', 'change_product', 'product'])

/**
 * Processes a post-purchase claim: a return, a cancellation after the fact, or a
 * refund where the buyer keeps the item.
 *
 * The claim's `type` says the sale is being unwound; the expected resolutions say
 * whether goods are actually coming back, which is the difference between stock
 * we'll get to resell and stock we've simply lost. A `mediations` claim is only
 * a conversation, so it's left alone until it turns into one of the above.
 */
export async function processClaim(
  account: MercadoLibreAccount,
  claimId: string
): Promise<{ status: 'reversed' | 'skipped'; reason?: string }> {
  const claim = await getClaim(account, claimId)

  if (!REVERSING_CLAIM_TYPES.has(claim.type)) {
    return { status: 'skipped', reason: `claim_type:${claim.type}` }
  }
  // Claims can hang off a payment or shipment; only order-scoped ones map to a Sale.
  if (claim.resource !== 'order') {
    return { status: 'skipped', reason: `claim_resource:${claim.resource}` }
  }

  const mlOrderId = String(claim.resource_id)
  const sale = await prisma.sale.findUnique({
    where: { mlOrderId },
    include: { product: { select: { name: true } } },
  })
  if (!sale) return { status: 'skipped', reason: 'no_sale' }

  // `claimed_quantity` is absent on older claims and on total claims; both mean
  // the whole order.
  const quantity =
    claim.quantity_type === 'partial' && claim.claimed_quantity
      ? Math.min(claim.claimed_quantity, sale.quantity)
      : sale.quantity

  let goodsComingBack = true
  try {
    const resolutions = await getClaimExpectedResolutions(account, claimId)
    if (resolutions.length > 0) {
      goodsComingBack = resolutions.some(
        (r) => r.expected_resolution && GOODS_RETURNING_RESOLUTIONS.has(r.expected_resolution)
      )
    }
  } catch (err) {
    // Resolutions are advisory. If ML won't tell us, assume goods are coming back
    // — that keeps stock out of the sellable pool until someone confirms receipt,
    // which is the safe direction to be wrong in.
    console.error('[ml claim] expected-resolutions failed:', err)
  }

  const reason = claim.reason_id
    ? `ML claim ${claim.type} (${claim.reason_id})`
    : `ML claim ${claim.type}`

  const result = goodsComingBack
    ? await openReturn({ saleId: sale.id, quantity, reason, mlClaimId: String(claim.id) })
    : await refundWithoutReturn({
        saleId: sale.id,
        quantity,
        reason,
        mlClaimId: String(claim.id),
      })

  if (result.status === 'noop') return { status: 'skipped', reason: result.reason }

  await sendTelegramMessage(
    returnOpenedMessage({
      productName: sale.product.name,
      quantity: result.quantity,
      accountNickname: account.nickname,
      refundedArs: sale.salePriceArs * (result.quantity / sale.quantity),
      claimType: claim.type,
      reason: claim.reason_id ?? undefined,
      goodsComingBack,
    })
  )

  return { status: 'reversed' }
}
