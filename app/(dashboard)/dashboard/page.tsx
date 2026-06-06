import Link from 'next/link'
import {
  DollarSign,
  TrendingUp,
  Boxes,
  AlertTriangle,
  Truck,
  Wallet,
} from 'lucide-react'
import { PageHeader } from '@/components/dashboard/page-header'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { ProfitTrendChart } from '@/components/dashboard/profit-trend-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  getDashboardMetrics,
  getRecentSales,
  getLowStockProducts,
  getIncomingInventory,
  getTopSellers,
  getProfitTrend,
} from '@/lib/metrics'
import { formatArs, formatUsd, formatDateTime, formatNumber } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const [metrics, recentSales, lowStock, incoming, topSellers, trend] = await Promise.all([
    getDashboardMetrics(),
    getRecentSales(),
    getLowStockProducts(),
    getIncomingInventory(),
    getTopSellers(),
    getProfitTrend(14),
  ])

  return (
    <div>
      <PageHeader title="Dashboard" description="Today at a glance across all accounts." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Revenue today" value={formatArs(metrics.revenueTodayArs)} icon={DollarSign} />
        <KpiCard label="Revenue month" value={formatArs(metrics.revenueMonthArs)} icon={DollarSign} />
        <KpiCard label="Profit today" value={formatUsd(metrics.profitTodayUsd)} icon={TrendingUp} />
        <KpiCard label="Profit month" value={formatUsd(metrics.profitMonthUsd)} icon={TrendingUp} />
        <KpiCard label="Inventory value" value={formatUsd(metrics.inventoryValueUsd)} icon={Wallet} />
        <KpiCard
          label="Low on stock"
          value={metrics.lowStockCount}
          icon={AlertTriangle}
          hint={`${metrics.inTransitUnits} units in transit`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Profit trend (14 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfitTrendChart data={trend} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Boxes className="size-4" /> Sales by account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {metrics.salesByAccount.length === 0 && (
              <p className="text-sm text-muted-foreground">No sales this month.</p>
            )}
            {metrics.salesByAccount.map((a) => (
              <div key={a.nickname} className="flex items-center justify-between text-sm">
                <span className="font-medium">{a.nickname}</span>
                <span className="text-muted-foreground">
                  {a.count} · {formatArs(a.revenueArs)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Recent sales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentSales.length === 0 && (
              <p className="text-sm text-muted-foreground">No sales yet.</p>
            )}
            {recentSales.map((s) => (
              <div key={s.id} className="text-sm">
                <div className="flex justify-between gap-2">
                  <span className="truncate font-medium">{s.product.name}</span>
                  <span className="shrink-0 text-emerald-600 dark:text-emerald-400">
                    {formatUsd(s.profitUsd)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {s.account.nickname} · {formatDateTime(s.soldAt)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4" /> Low stock alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lowStock.length === 0 && (
              <p className="text-sm text-muted-foreground">All good.</p>
            )}
            {lowStock.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <Link href={`/products/${p.id}`} className="truncate font-medium hover:underline">
                  {p.name}
                </Link>
                <Badge variant="destructive">
                  {p.available}/{p.minStock}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="size-4" /> Incoming inventory
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {incoming.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing in transit.</p>
            )}
            {incoming.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span className="truncate font-medium">{b.product.name}</span>
                <span className="text-muted-foreground">{b.remainingQuantity} units</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4" /> Top sellers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topSellers.length === 0 && (
              <p className="text-sm text-muted-foreground">No sales yet.</p>
            )}
            {topSellers.map((t) => (
              <div key={t.name} className="flex items-center justify-between text-sm">
                <span className="truncate font-medium">{t.name}</span>
                <span className="text-muted-foreground">{formatNumber(t.units)} sold</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
