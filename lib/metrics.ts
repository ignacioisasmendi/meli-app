import 'server-only'
import { startOfDay, startOfMonth, subDays, format } from 'date-fns'
import { prisma } from '@/lib/prisma'
import { getInTransit, stockViewFrom, IN_TRANSIT_STATUSES } from '@/lib/inventory/stock'

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

  const [today, month, products, inTransitAgg, byAccount, accounts] = await Promise.all([
    prisma.sale.aggregate({
      where: { soldAt: { gte: dayStart } },
      _sum: { salePriceArs: true, profitUsd: true },
    }),
    prisma.sale.aggregate({
      where: { soldAt: { gte: monthStart } },
      _sum: { salePriceArs: true, profitUsd: true },
    }),
    prisma.product.findMany({ where: { archived: false } }),
    prisma.inventoryBatch.aggregate({
      where: { status: { in: IN_TRANSIT_STATUSES } },
      _sum: { remainingQuantity: true },
    }),
    prisma.sale.groupBy({
      by: ['accountId'],
      where: { soldAt: { gte: monthStart } },
      _sum: { salePriceArs: true },
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
      revenueArs: b._sum.salePriceArs ?? 0,
    }))
    .sort((a, b) => b.revenueArs - a.revenueArs)

  return {
    revenueTodayArs: today._sum.salePriceArs ?? 0,
    revenueMonthArs: month._sum.salePriceArs ?? 0,
    profitTodayUsd: today._sum.profitUsd ?? 0,
    profitMonthUsd: month._sum.profitUsd ?? 0,
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
  const grouped = await prisma.sale.groupBy({
    by: ['productId'],
    _sum: { quantity: true, profitUsd: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  })
  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((g) => g.productId) } },
    select: { id: true, name: true },
  })
  const nameById = new Map(products.map((p) => [p.id, p.name]))
  return grouped.map((g) => ({
    name: nameById.get(g.productId) ?? g.productId,
    units: g._sum.quantity ?? 0,
    profitUsd: g._sum.profitUsd ?? 0,
  }))
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
    select: { soldAt: true, profitUsd: true },
  })

  const buckets = new Map<string, number>()
  for (let i = 0; i < days; i++) {
    buckets.set(format(subDays(new Date(), days - 1 - i), 'yyyy-MM-dd'), 0)
  }
  for (const s of sales) {
    const key = format(s.soldAt, 'yyyy-MM-dd')
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + s.profitUsd)
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
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: 1,
  })
  if (grouped.length === 0) return null
  const product = await prisma.product.findUnique({
    where: { id: grouped[0].productId },
    select: { name: true },
  })
  return product?.name ?? null
}
