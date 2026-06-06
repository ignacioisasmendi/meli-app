import { Download } from 'lucide-react'
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
  return (
    <Button asChild variant="outline" size="sm">
      <a href={`/api/reports/${type}`}>
        <Download className="size-4" />
        Export CSV
      </a>
    </Button>
  )
}

export default async function ReportsPage() {
  const [inventory, sales, purchases, profitability] = await Promise.all([
    getInventoryReport(),
    getSalesReport(),
    getPurchaseReport(),
    getProfitabilityReport(),
  ])

  return (
    <div>
      <PageHeader title="Reports" description="Inventory, sales, purchases and profitability." />

      <Tabs defaultValue="inventory">
        <TabsList>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="purchases">Purchases</TabsTrigger>
          <TabsTrigger value="profitability">Profitability</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <ExportButton type="inventory" />
          </div>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">In transit</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Value (USD)</TableHead>
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
                  <TableHead>Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Profit (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">{formatDate(r.date)}</TableCell>
                    <TableCell className="font-medium">{r.product}</TableCell>
                    <TableCell>{r.account}</TableCell>
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
                  <TableHead>Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Total cost</TableHead>
                  <TableHead>Status</TableHead>
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
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
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
