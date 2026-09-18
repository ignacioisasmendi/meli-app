import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { AdjustStockDialog } from '@/components/inventory/adjust-stock-dialog'
import { Badge } from '@/components/ui/badge'
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
import { formatUsd } from '@/lib/utils'
import { getBatchLocations, stockViewFrom, type StockView } from '@/lib/inventory/stock'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  name: string
  sku: string
  minStock: number
  averageCostUsd: number
  view: StockView
}

function InventoryTable({ rows, column }: { rows: Row[]; column: keyof StockView }) {
  const t = useTranslations('Inventory')
  const filtered = rows.filter((r) => r.view[column] > 0)
  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('product')}</TableHead>
            <TableHead>{t('sku')}</TableHead>
            <TableHead className="text-right">{t('qty')}</TableHead>
            <TableHead className="text-right">{t('valueUsd')}</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                {t('nothingHere')}
              </TableCell>
            </TableRow>
          )}
          {filtered.map((r) => {
            const qty = r.view[column]
            const low = (column === 'received' || column === 'full') && r.view.available <= r.minStock
            return (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{r.sku}</TableCell>
                <TableCell className="text-right">
                  <span className={low ? 'font-semibold text-destructive' : ''}>{qty}</span>
                  {low && (
                    <Badge variant="destructive" className="ml-2">
                      {t('low')}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatUsd(qty * r.averageCostUsd)}
                </TableCell>
                <TableCell>
                  <AdjustStockDialog productId={r.id} productName={r.name} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}

export default async function InventoryPage() {
  const t = await getTranslations('Inventory')
  const products = await prisma.product.findMany({
    where: { archived: false },
    orderBy: { name: 'asc' },
  })
  const locations = await getBatchLocations(products.map((p) => p.id))
  const rows: Row[] = products.map((p) => {
    const { inTransit, inFull } = locations.get(p.id)!
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      minStock: p.minStock,
      averageCostUsd: p.averageCostUsd,
      view: stockViewFrom(p, inTransit, inFull),
    }
  })

  const totalValue = rows.reduce((s, r) => s + r.view.available * r.averageCostUsd, 0)

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('totalAvailableValue', { value: formatUsd(totalValue) })}
      />

      <Tabs defaultValue="received">
        <TabsList>
          <TabsTrigger value="inTransit">{t('inTransit')}</TabsTrigger>
          <TabsTrigger value="received">{t('received')}</TabsTrigger>
          <TabsTrigger value="full">{t('full')}</TabsTrigger>
          <TabsTrigger value="reserved">{t('reserved')}</TabsTrigger>
        </TabsList>
        <TabsContent value="inTransit" className="mt-4">
          <InventoryTable rows={rows} column="inTransit" />
        </TabsContent>
        <TabsContent value="received" className="mt-4">
          <InventoryTable rows={rows} column="received" />
        </TabsContent>
        <TabsContent value="full" className="mt-4">
          <InventoryTable rows={rows} column="full" />
        </TabsContent>
        <TabsContent value="reserved" className="mt-4">
          <InventoryTable rows={rows} column="reserved" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
