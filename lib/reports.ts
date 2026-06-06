import 'server-only'
import { prisma } from '@/lib/prisma'
import { getInTransit, stockViewFrom } from '@/lib/inventory/stock'
import { getUsdArsRate } from '@/lib/settings'

export interface InventoryReportRow {
  sku: string
  name: string
  available: number
  inTransit: number
  reserved: number
  valueUsd: number
}

export async function getInventoryReport(): Promise<InventoryReportRow[]> {
  const products = await prisma.product.findMany({
    where: { archived: false },
    orderBy: { name: 'asc' },
  })
  return Promise.all(
    products.map(async (p) => {
      const view = stockViewFrom(p, await getInTransit(p.id))
      return {
        sku: p.sku,
        name: p.name,
        available: view.available,
        inTransit: view.inTransit,
        reserved: view.reserved,
        valueUsd: view.available * p.averageCostUsd,
      }
    })
  )
}

export interface SalesReportRow {
  date: Date
  product: string
  account: string
  quantity: number
  revenueArs: number
  profitUsd: number
}

export async function getSalesReport(range?: {
  from?: Date
  to?: Date
}): Promise<SalesReportRow[]> {
  const sales = await prisma.sale.findMany({
    where: {
      ...(range?.from || range?.to
        ? { soldAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
        : {}),
    },
    include: {
      product: { select: { name: true } },
      account: { select: { nickname: true } },
    },
    orderBy: { soldAt: 'desc' },
  })
  return sales.map((s) => ({
    date: s.soldAt,
    product: s.product.name,
    account: s.account.nickname,
    quantity: s.quantity,
    revenueArs: s.salePriceArs,
    profitUsd: s.profitUsd,
  }))
}

export interface PurchaseReportRow {
  date: Date
  product: string
  quantity: number
  totalCostUsd: number
  status: string
}

export async function getPurchaseReport(): Promise<PurchaseReportRow[]> {
  const purchases = await prisma.purchase.findMany({
    include: { product: { select: { name: true } } },
    orderBy: { purchasedAt: 'desc' },
  })
  return purchases.map((p) => ({
    date: p.purchasedAt,
    product: p.product.name,
    quantity: p.quantity,
    totalCostUsd: p.totalCostUsd,
    status: p.status,
  }))
}

export interface ProfitabilityReportRow {
  product: string
  units: number
  revenueUsd: number
  costUsd: number
  profitUsd: number
  marginPct: number
}

export async function getProfitabilityReport(): Promise<ProfitabilityReportRow[]> {
  const rate = await getUsdArsRate()
  const grouped = await prisma.sale.groupBy({
    by: ['productId'],
    _sum: { salePriceArs: true, feeArs: true, shippingArs: true, profitUsd: true, quantity: true },
  })
  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((g) => g.productId) } },
    select: { id: true, name: true },
  })
  const nameById = new Map(products.map((p) => [p.id, p.name]))

  return grouped
    .map((g) => {
      const netArs =
        (g._sum.salePriceArs ?? 0) - (g._sum.feeArs ?? 0) - (g._sum.shippingArs ?? 0)
      const revenueUsd = netArs / rate
      const profitUsd = g._sum.profitUsd ?? 0
      const costUsd = revenueUsd - profitUsd
      const marginPct = revenueUsd > 0 ? (profitUsd / revenueUsd) * 100 : 0
      return {
        product: nameById.get(g.productId) ?? g.productId,
        units: g._sum.quantity ?? 0,
        revenueUsd,
        costUsd,
        profitUsd,
        marginPct,
      }
    })
    .sort((a, b) => b.profitUsd - a.profitUsd)
}
