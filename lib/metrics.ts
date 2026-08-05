import 'server-only'
import { startOfDay, startOfMonth, subDays, format } from 'date-fns'
import { prisma } from '@/lib/prisma'
import { getInTransit, stockViewFrom, IN_TRANSIT_STATUSES } from '@/lib/inventory/stock'

/** Columns every revenue/profit aggregate needs to net cancellations out. */
const REVERSAL_AWARE_SUMS = {
  salePriceArs: true,
  refundedArs: true,
  profitUsd: true,
  reversedProfitUsd: true,
} as const

export interface DashboardMetrics {
  revenueTodayArs: number
  revenueMonthArs: number
  profitTodayUsd: number
  profitMonthUsd: number
  inventoryValueUsd: number
  lowStockCount: number
  inTransitUnits: number
  salesByAccount: { nickname: string; count: number; revenueArs: number }[]
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const now = new Date()
  const dayStart = startOfDay(now)
  const monthStart = startOfMonth(now)

  // Reversals are netted arithmetically rather than filtered out: gross figures
  // and their refunds sit on the same row, so `SUM(gross) - SUM(refunded)` keeps
  // every metric a single aggregate and gets partial returns right for free.
  const [today, month, products, inTransitAgg, byAccount, accounts] = await Promise.all([
    prisma.sale.aggregate({
      where: { soldAt: { gte: dayStart } },
      _sum: REVERSAL_AWARE_SUMS,
    }),
    prisma.sale.aggregate({
      where: { soldAt: { gte: monthStart } },
      _sum: REVERSAL_AWARE_SUMS,
    }),
    prisma.product.findMany({ where: { archived: false } }),
    prisma.inventoryBatch.aggregate({
      where: { status: { in: IN_TRANSIT_STATUSES } },
      _sum: { remainingQuantity: true },
    }),
    prisma.sale.groupBy({
      by: ['accountId'],
      where: { soldAt: { gte: monthStart } },
      _sum: { salePriceArs: true, refundedArs: true },
      _count: { _all: true },
    }),
    prisma.mercadoLibreAccount.findMany({ select: { id: true, nickname: true } }),
  ])

  let inventoryValueUsd = 0
  let lowStockCount = 0
  for (const p of products) {
    const view = stockViewFrom(p, await getInTransit(p.id))
    inventoryValueUsd += view.available * p.averageCostUsd
    if (view.available <= p.minStock) lowStockCount++
  }

  const nameById = new Map(accounts.map((a) => [a.id, a.nickname]))
  const salesByAccount = byAccount
    .map((b) => ({
      nickname: nameById.get(b.accountId) ?? b.accountId,
      count: b._count._all,
      revenueArs: (b._sum.salePriceArs ?? 0) - (b._sum.refundedArs ?? 0),
    }))
    .sort((a, b) => b.revenueArs - a.revenueArs)

  return {
    revenueTodayArs: (today._sum.salePriceArs ?? 0) - (today._sum.refundedArs ?? 0),
    revenueMonthArs: (month._sum.salePriceArs ?? 0) - (month._sum.refundedArs ?? 0),
    profitTodayUsd: (today._sum.profitUsd ?? 0) - (today._sum.reversedProfitUsd ?? 0),
    profitMonthUsd: (month._sum.profitUsd ?? 0) - (month._sum.reversedProfitUsd ?? 0),
    inventoryValueUsd,
    lowStockCount,
    inTransitUnits: inTransitAgg._sum.remainingQuantity ?? 0,
    salesByAccount,
  }
}

export async function getRecentSales(limit = 6) {
  return prisma.sale.findMany({
    include: {
      product: { select: { name: true } },
      account: { select: { nickname: true } },
    },
    orderBy: { soldAt: 'desc' },
    take: limit,
  })
}

export async function getLowStockProducts(limit = 6) {
  const products = await prisma.product.findMany({ where: { archived: false } })
  const rows = await Promise.all(
    products.map(async (p) => ({
      id: p.id,
      name: p.name,
      minStock: p.minStock,
      available: stockViewFrom(p, await getInTransit(p.id)).available,
    }))
  )
  return rows
    .filter((r) => r.available <= r.minStock)
    .sort((a, b) => a.available - b.available)
    .slice(0, limit)
}

export async function getIncomingInventory(limit = 6) {
  return prisma.inventoryBatch.findMany({
    where: { status: { in: IN_TRANSIT_STATUSES }, remainingQuantity: { gt: 0 } },
    include: { product: { select: { name: true } } },
    orderBy: { purchasedAt: 'asc' },
    take: limit,
  })
}

export async function getTopSellers(limit = 6) {
  // Ordered by gross units because Prisma can't order by an expression; a
  // product whose sales were mostly returned can therefore rank higher than its
  // net units deserve. Over-fetch and re-sort on net so the list stays honest.
  const grouped = await prisma.sale.groupBy({
    by: ['productId'],
    _sum: {
      quantity: true,
      returnedQuantity: true,
      profitUsd: true,
      reversedProfitUsd: true,
    },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit * 3,
  })
  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((g) => g.productId) } },
    select: { id: true, name: true },
  })
  const nameById = new Map(products.map((p) => [p.id, p.name]))
  return grouped
    .map((g) => ({
      name: nameById.get(g.productId) ?? g.productId,
      units: (g._sum.quantity ?? 0) - (g._sum.returnedQuantity ?? 0),
      profitUsd: (g._sum.profitUsd ?? 0) - (g._sum.reversedProfitUsd ?? 0),
    }))
    .filter((r) => r.units > 0)
    .sort((a, b) => b.units - a.units)
    .slice(0, limit)
}

export interface TrendPoint {
  date: string
  profitUsd: number
}

/** Daily profit (USD) for the last `days` days, oldest first. */
export async function getProfitTrend(days = 14): Promise<TrendPoint[]> {
  const start = startOfDay(subDays(new Date(), days - 1))
  const sales = await prisma.sale.findMany({
    where: { soldAt: { gte: start } },
    select: { soldAt: true, profitUsd: true, reversedProfitUsd: true },
  })

  const buckets = new Map<string, number>()
  for (let i = 0; i < days; i++) {
    buckets.set(format(subDays(new Date(), days - 1 - i), 'yyyy-MM-dd'), 0)
  }
  // A reversal is booked against the day the sale happened, not the day it was
  // refunded, so each bar stays "what that day's orders were actually worth".
  for (const s of sales) {
    const key = format(s.soldAt, 'yyyy-MM-dd')
    const net = s.profitUsd - s.reversedProfitUsd
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + net)
  }
  return Array.from(buckets.entries()).map(([date, profitUsd]) => ({
    date: format(new Date(date), 'MMM d'),
    profitUsd: Number(profitUsd.toFixed(2)),
  }))
}

/** Best-selling product name in a date range (for the daily summary). */
export async function getBestSeller(from: Date): Promise<string | null> {
  const grouped = await prisma.sale.groupBy({
    by: ['productId'],
    where: { soldAt: { gte: from } },
    _sum: { quantity: true, returnedQuantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: 10,
  })
  const best = grouped
    .map((g) => ({
      productId: g.productId,
      units: (g._sum.quantity ?? 0) - (g._sum.returnedQuantity ?? 0),
    }))
    .sort((a, b) => b.units - a.units)
    .find((g) => g.units > 0)
  if (!best) return null
  const product = await prisma.product.findUnique({
    where: { id: best.productId },
    select: { name: true },
  })
  return product?.name ?? null
}
