import 'server-only'
import { SaleStatus, type Sale } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { reverseSale } from '@/lib/inventory/stock'
import { checkLowStock } from '@/lib/inventory/alerts'

/**
 * Sale reversals — cancellations, returns and refunds.
 *
 * Splits the same way `shipment.ts` / `shipment-costing.ts` do: the batch and
 * counter mechanics live in `stock.ts`, and this file owns the sale-level story
 * (status transitions, how much money goes back, notifications).
 *
 * The four entry points map onto what Mercado Libre actually tells us:
 *   cancelSale          — order.status went to `cancelled`; it never shipped.
 *   openReturn          — a claim wants the goods back; money out now, stock later.
 *   receiveReturn       — the box is in our hands (this is the only restock).
 *   refundWithoutReturn — refunded and the buyer keeps it; nothing comes back.
 */

/** Sale statuses where money has been given back, in whole or in part. */
export const REVERSED_STATUSES: SaleStatus[] = [
  SaleStatus.CANCELLED,
  SaleStatus.RETURN_PENDING,
  SaleStatus.RETURNED,
  SaleStatus.REFUNDED,
]

type ReversalFields = Pick<
  Sale,
  'salePriceArs' | 'refundedArs' | 'profitUsd' | 'reversedProfitUsd'
>

/** Revenue that still counts, after refunds. */
export function netRevenueArs(sale: ReversalFields): number {
  return sale.salePriceArs - sale.refundedArs
}

/** Profit that still counts, after reversals and write-offs. */
export function netProfitUsd(sale: ReversalFields): number {
  return sale.profitUsd - sale.reversedProfitUsd
}

export interface ReversalResult {
  status: 'applied' | 'noop'
  quantity: number
  reason?: string
}

/** Units on this sale not yet reversed. */
function reversibleQuantity(sale: Sale, requested?: number): number {
  const left = sale.quantity - sale.returnedQuantity
  if (left <= 0) return 0
  return requested === undefined ? left : Math.min(requested, left)
}

/** Pro-rata share of the sale's gross figures for `quantity` of its units. */
function share(sale: Sale, quantity: number) {
  const fraction = sale.quantity > 0 ? quantity / sale.quantity : 0
  return {
    refundArs: sale.salePriceArs * fraction,
    profitUsd: sale.profitUsd * fraction,
    costUsd: sale.costUsd * fraction,
  }
}

/**
 * Reverses an order that was cancelled before it shipped. The units never left,
 * so they go straight back to sellable stock.
 */
export async function cancelSale(params: {
  saleId: string
  reason?: string
  mlClaimId?: string
}): Promise<ReversalResult> {
  const sale = await prisma.sale.findUniqueOrThrow({ where: { id: params.saleId } })
  const quantity = reversibleQuantity(sale)
  if (quantity === 0) return { status: 'noop', quantity: 0, reason: 'already_reversed' }

  const { refundArs, profitUsd } = share(sale, quantity)

  await prisma.$transaction(async (tx) => {
    await reverseSale(tx, {
      productId: sale.productId,
      saleId: sale.id,
      quantity,
      restock: true,
      note: params.reason ? `Order cancelled: ${params.reason}` : 'Order cancelled',
    })
    await tx.sale.update({
      where: { id: sale.id },
      data: {
        status: SaleStatus.CANCELLED,
        returnedQuantity: { increment: quantity },
        restockedQuantity: { increment: quantity },
        refundedArs: { increment: refundArs },
        reversedProfitUsd: { increment: profitUsd },
        mlClaimId: params.mlClaimId ?? sale.mlClaimId,
        reversalReason: params.reason ?? sale.reversalReason,
        reversedAt: new Date(),
      },
    })
  })

  return { status: 'applied', quantity }
}

/**
 * Records that a buyer is sending goods back. Revenue and profit are backed out
 * immediately — the money is gone the moment ML refunds it — but stock is not
 * touched, because the units are still in the mail. `receiveReturn` completes it.
 */
export async function openReturn(params: {
  saleId: string
  quantity?: number
  reason?: string
  mlClaimId?: string
}): Promise<ReversalResult> {
  const sale = await prisma.sale.findUniqueOrThrow({ where: { id: params.saleId } })
  const quantity = reversibleQuantity(sale, params.quantity)
  if (quantity === 0) return { status: 'noop', quantity: 0, reason: 'already_reversed' }

  const { refundArs, profitUsd } = share(sale, quantity)

  await prisma.sale.update({
    where: { id: sale.id },
    data: {
      status: SaleStatus.RETURN_PENDING,
      returnedQuantity: { increment: quantity },
      refundedArs: { increment: refundArs },
      reversedProfitUsd: { increment: profitUsd },
      mlClaimId: params.mlClaimId ?? sale.mlClaimId,
      reversalReason: params.reason ?? sale.reversalReason,
      reversedAt: new Date(),
    },
  })

  return { status: 'applied', quantity }
}

/**
 * Confirms returned goods are physically in hand. This is the only path that
 * puts sold units back on the shelf.
 *
 * `resellable: false` writes them off: they stop counting as sold, but they
 * never become available and their cost is added to the profit reversal — a
 * scrapped return loses the revenue *and* eats the COGS, so the hit is bigger
 * than the sale's own profit.
 */
export async function receiveReturn(params: {
  saleId: string
  quantity?: number
  resellable: boolean
  note?: string
}): Promise<ReversalResult> {
  const sale = await prisma.sale.findUniqueOrThrow({ where: { id: params.saleId } })

  // Only units already marked as coming back can be received, and only once.
  const outstanding = sale.returnedQuantity - sale.restockedQuantity
  if (outstanding <= 0) return { status: 'noop', quantity: 0, reason: 'nothing_outstanding' }
  const quantity = Math.min(params.quantity ?? outstanding, outstanding)

  const reversedCostUsd = await prisma.$transaction(async (tx) => {
    const { reversedCostUsd } = await reverseSale(tx, {
      productId: sale.productId,
      saleId: sale.id,
      quantity,
      restock: params.resellable,
      note: params.note ?? (params.resellable ? 'Return received' : 'Return unsellable'),
    })
    await tx.sale.update({
      where: { id: sale.id },
      data: {
        // Stay RETURN_PENDING while part of the return is still in the mail, so
        // the remainder keeps showing up as awaiting receipt.
        status: quantity < outstanding ? SaleStatus.RETURN_PENDING : SaleStatus.RETURNED,
        // Counts the units as settled either way; a write-off is settled at zero
        // stock, which is what stops it being received a second time.
        restockedQuantity: { increment: quantity },
        ...(params.resellable
          ? {}
          : { reversedProfitUsd: { increment: reversedCostUsd } }),
        ...(params.note ? { reversalReason: params.note } : {}),
      },
    })
    return reversedCostUsd
  })

  if (params.resellable) await checkLowStock(sale.productId)

  return { status: 'applied', quantity, reason: `cost_usd:${reversedCostUsd.toFixed(2)}` }
}

/**
 * Refund with no goods coming back — ML sometimes refunds the buyer and lets
 * them keep the item. Revenue reverses, the units stay sold-and-gone, and the
 * COGS is sunk, so the whole unit economics turn into a loss.
 */
export async function refundWithoutReturn(params: {
  saleId: string
  quantity?: number
  reason?: string
  mlClaimId?: string
}): Promise<ReversalResult> {
  const sale = await prisma.sale.findUniqueOrThrow({ where: { id: params.saleId } })
  const quantity = reversibleQuantity(sale, params.quantity)
  if (quantity === 0) return { status: 'noop', quantity: 0, reason: 'already_reversed' }

  const { refundArs, profitUsd, costUsd } = share(sale, quantity)

  await prisma.sale.update({
    where: { id: sale.id },
    data: {
      status: SaleStatus.REFUNDED,
      returnedQuantity: { increment: quantity },
      // Nothing to restock, but the units are settled — mark them so the return
      // never shows up as awaiting receipt.
      restockedQuantity: { increment: quantity },
      refundedArs: { increment: refundArs },
      reversedProfitUsd: { increment: profitUsd + costUsd },
      mlClaimId: params.mlClaimId ?? sale.mlClaimId,
      reversalReason: params.reason ?? sale.reversalReason,
      reversedAt: new Date(),
    },
  })

  return { status: 'applied', quantity }
}

/** Sales with goods the buyer is sending back that we haven't received yet. */
export async function getPendingReturns(limit = 50) {
  const sales = await prisma.sale.findMany({
    where: { status: SaleStatus.RETURN_PENDING },
    include: {
      product: { select: { name: true, sku: true } },
      account: { select: { nickname: true } },
    },
    orderBy: { reversedAt: 'desc' },
    take: limit,
  })
  // A partial receipt leaves the sale RETURN_PENDING with fewer units awaiting.
  return sales
    .map((s) => ({ ...s, awaitingQuantity: s.returnedQuantity - s.restockedQuantity }))
    .filter((s) => s.awaitingQuantity > 0)
}
