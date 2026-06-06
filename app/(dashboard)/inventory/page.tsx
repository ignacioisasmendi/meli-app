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
import { getInTransit, stockViewFrom, type StockView } from '@/lib/inventory/stock'

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
  const filtered = rows.filter((r) => r.view[column] > 0)
  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Value (USD)</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                Nothing here.
              </TableCell>
            </TableRow>
          )}
          {filtered.map((r) => {
            const qty = r.view[column]
            const low = column === 'available' && qty <= r.minStock
            return (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{r.sku}</TableCell>
                <TableCell className="text-right">
                  <span className={low ? 'font-semibold text-destructive' : ''}>{qty}</span>
                  {low && (
                    <Badge variant="destructive" className="ml-2">
                      Low
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
  const products = await prisma.product.findMany({
    where: { archived: false },
    orderBy: { name: 'asc' },
  })
  const rows: Row[] = await Promise.all(
    products.map(async (p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      minStock: p.minStock,
      averageCostUsd: p.averageCostUsd,
      view: stockViewFrom(p, await getInTransit(p.id)),
    }))
  )

  const totalValue = rows.reduce((s, r) => s + r.view.available * r.averageCostUsd, 0)

  return (
    <div>
      <PageHeader
        title="Inventory"
        description={`Total available value: ${formatUsd(totalValue)}`}
      />

      <Tabs defaultValue="available">
        <TabsList>
          <TabsTrigger value="available">Available</TabsTrigger>
          <TabsTrigger value="inTransit">In transit</TabsTrigger>
          <TabsTrigger value="reserved">Reserved</TabsTrigger>
        </TabsList>
        <TabsContent value="available" className="mt-4">
          <InventoryTable rows={rows} column="available" />
        </TabsContent>
        <TabsContent value="inTransit" className="mt-4">
          <InventoryTable rows={rows} column="inTransit" />
        </TabsContent>
        <TabsContent value="reserved" className="mt-4">
          <InventoryTable rows={rows} column="reserved" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
