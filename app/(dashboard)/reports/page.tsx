import { Download } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/dashboard/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/dashboard/status-badge'
import {
  getInventoryReport,
  getSalesReport,
  getPurchaseReport,
  getProfitabilityReport,
} from '@/lib/reports'
import { formatArs, formatDate, formatNumber, formatPercent, formatUsd } from '@/lib/utils'

export const dynamic = 'force-dynamic'

function ExportButton({ type }: { type: string }) {
  const t = useTranslations('Reports')
  return (
    <Button asChild variant="outline" size="sm">
      <a href={`/api/reports/${type}`}>
        <Download className="size-4" />
        {t('exportCsv')}
      </a>
    </Button>
  )
}

export default async function ReportsPage() {
  const t = await getTranslations('Reports')
  const [inventory, sales, purchases, profitability] = await Promise.all([
    getInventoryReport(),
    getSalesReport(),
    getPurchaseReport(),
    getProfitabilityReport(),
  ])

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />

      <Tabs defaultValue="inventory">
        <TabsList>
          <TabsTrigger value="inventory">{t('inventory')}</TabsTrigger>
          <TabsTrigger value="sales">{t('sales')}</TabsTrigger>
          <TabsTrigger value="purchases">{t('purchases')}</TabsTrigger>
          <TabsTrigger value="profitability">{t('profitability')}</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <ExportButton type="inventory" />
          </div>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('sku')}</TableHead>
                  <TableHead>{t('product')}</TableHead>
                  <TableHead className="text-right">{t('available')}</TableHead>
                  <TableHead className="text-right">{t('inTransit')}</TableHead>
                  <TableHead className="text-right">{t('reserved')}</TableHead>
                  <TableHead className="text-right">{t('valueUsd')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventory.map((r) => (
                  <TableRow key={r.sku}>
                    <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">{r.available}</TableCell>
                    <TableCell className="text-right">{r.inTransit}</TableCell>
                    <TableCell className="text-right">{r.reserved}</TableCell>
                    <TableCell className="text-right">{formatUsd(r.valueUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="sales" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <ExportButton type="sales" />
          </div>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead>{t('product')}</TableHead>
                  <TableHead>{t('account')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead className="text-right">{t('qty')}</TableHead>
                  <TableHead className="text-right">{t('revenue')}</TableHead>
                  <TableHead className="text-right">{t('profitUsd')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">{formatDate(r.date)}</TableCell>
                    <TableCell className="font-medium">{r.product}</TableCell>
                    <TableCell>{r.account}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right">{r.quantity}</TableCell>
                    <TableCell className="text-right">{formatArs(r.revenueArs)}</TableCell>
                    <TableCell className="text-right">{formatUsd(r.profitUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="purchases" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <ExportButton type="purchases" />
          </div>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead>{t('product')}</TableHead>
                  <TableHead className="text-right">{t('qty')}</TableHead>
                  <TableHead className="text-right">{t('totalCost')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">{formatDate(r.date)}</TableCell>
                    <TableCell className="font-medium">{r.product}</TableCell>
                    <TableCell className="text-right">{r.quantity}</TableCell>
                    <TableCell className="text-right">{formatUsd(r.totalCostUsd)}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="profitability" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <ExportButton type="profitability" />
          </div>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('product')}</TableHead>
                  <TableHead className="text-right">{t('units')}</TableHead>
                  <TableHead className="text-right">{t('revenue')}</TableHead>
                  <TableHead className="text-right">{t('cost')}</TableHead>
                  <TableHead className="text-right">{t('profit')}</TableHead>
                  <TableHead className="text-right">{t('margin')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profitability.map((r) => (
                  <TableRow key={r.product}>
                    <TableCell className="font-medium">{r.product}</TableCell>
                    <TableCell className="text-right">{formatNumber(r.units)}</TableCell>
                    <TableCell className="text-right">{formatUsd(r.revenueUsd)}</TableCell>
                    <TableCell className="text-right">{formatUsd(r.costUsd)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatUsd(r.profitUsd)}
                    </TableCell>
                    <TableCell className="text-right">{formatPercent(r.marginPct)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
