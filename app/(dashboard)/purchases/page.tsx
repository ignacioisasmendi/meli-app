import Link from 'next/link'
import { ChevronRight, Import } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { OrderStatusSelect } from '@/components/purchases/order-status-select'
import { PurchaseFormDialog } from '@/components/purchases/purchase-form-dialog'
import { PurchaseStatusSelect } from '@/components/purchases/purchase-status-select'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate, formatUsd } from '@/lib/utils'
import { listPurchaseOrders, listUngroupedPurchases, summarizeOrder } from '@/lib/purchases'

export const dynamic = 'force-dynamic'

export default async function PurchasesPage() {
  const [orders, loose, products] = await Promise.all([
    listPurchaseOrders(),
    listUngroupedPurchases(),
    prisma.product.findMany({
      where: { archived: false },
      select: { id: true, name: true, sku: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <div>
      <PageHeader
        title="Purchases"
        description="One row per supplier order. Open one to see what each product cost, tax included."
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/purchases/import">
                <Import className="size-4" />
                Import order
              </Link>
            </Button>
            <PurchaseFormDialog products={products} />
          </div>
        }
      />

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Order</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Goods</TableHead>
              <TableHead className="text-right">Tax &amp; shipping</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Shipment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                  No orders yet. Import an Amazon order to get started.
                </TableCell>
              </TableRow>
            )}
            {orders.map((order) => {
              const s = summarizeOrder(order.purchases)
              return (
                <TableRow key={order.id}>
                  <TableCell className="text-muted-foreground">
                    {formatDate(order.purchasedAt)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/purchases/orders/${order.id}`}
                      className="font-medium hover:underline underline-offset-2"
                    >
                      {order.orderNumber}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">{order.supplier}</span>
                  </TableCell>
                  <TableCell className="text-right">{s.lineCount}</TableCell>
                  <TableCell className="text-right">{s.units}</TableCell>
                  <TableCell className="text-right">{formatUsd(s.goodsUsd)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {s.extrasUsd > 0 ? formatUsd(s.extrasUsd) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatUsd(s.totalUsd)}</TableCell>
                  <TableCell>
                    {s.shipments.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : s.shipments.length === 1 ? (
                      <Link
                        href={`/shipments/${s.shipments[0].id}`}
                        className="text-sm hover:underline underline-offset-2"
                      >
                        {s.shipments[0].code}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {s.shipments.length} shipments
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <OrderStatusSelect
                      orderId={order.id}
                      status={s.status}
                      lineCount={s.lineCount}
                    />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/purchases/orders/${order.id}`}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Open order ${order.orderNumber}`}
                    >
                      <ChevronRight className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      {loose.length > 0 && (
        <Card className="mt-6 overflow-hidden p-0">
          <CardHeader className="pt-6">
            <CardTitle className="text-base">Purchases without an order</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Shipment</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loose.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-muted-foreground">
                    {formatDate(p.purchasedAt)}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/products/${p.product.id}`}
                      className="hover:underline underline-offset-2"
                    >
                      {p.product.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {p.product.sku}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{p.quantity}</TableCell>
                  <TableCell className="text-right">{formatUsd(p.unitCostUsd)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatUsd(p.totalCostUsd)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.supplier ?? '—'}</TableCell>
                  <TableCell>
                    {p.batches[0]?.shipment ? (
                      <Link
                        href={`/shipments/${p.batches[0].shipment.id}`}
                        className="text-sm hover:underline underline-offset-2"
                      >
                        {p.batches[0].shipment.code}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <PurchaseStatusSelect purchaseId={p.id} status={p.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
