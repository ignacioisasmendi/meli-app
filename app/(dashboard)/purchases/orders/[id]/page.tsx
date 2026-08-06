import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/dashboard/page-header'
import { OrderStatusSelect } from '@/components/purchases/order-status-select'
import { PurchaseStatusSelect } from '@/components/purchases/purchase-status-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate, formatUsd } from '@/lib/utils'
import { getPurchaseOrder, lineExtrasUsd, lineFreight, summarizeOrder } from '@/lib/purchases'

export const dynamic = 'force-dynamic'

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const order = await getPurchaseOrder(id)
  if (!order) notFound()

  const summary = summarizeOrder(order.purchases)
  // Freight columns only earn their space once a shipment has been costed.
  const hasFreight = summary.freightUsd > 0

  const stats = [
    { label: 'Items', value: String(summary.lineCount) },
    { label: 'Units', value: String(summary.units) },
    { label: 'Goods', value: formatUsd(summary.goodsUsd) },
    { label: 'Tax & shipping', value: formatUsd(summary.extrasUsd) },
    { label: 'Order total', value: formatUsd(summary.totalUsd) },
    ...(hasFreight
      ? [
          {
            label: summary.freightIsEstimate ? 'Freight (est.)' : 'Freight',
            value: formatUsd(summary.freightUsd),
          },
          { label: 'Landed', value: formatUsd(summary.landedUsd) },
        ]
      : []),
  ]

  return (
    <div>
      <PageHeader
        title={order.orderNumber}
        description={`${order.supplier} · ${formatDate(order.purchasedAt)} · tax and shipping split across the items by value`}
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/purchases">
                <ArrowLeft className="size-4" />
                Purchases
              </Link>
            </Button>
            <OrderStatusSelect
              orderId={order.id}
              status={summary.status}
              lineCount={summary.lineCount}
            />
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-2xl font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Tax &amp; shipping</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              <TableHead className="text-right">Line total</TableHead>
              {hasFreight && <TableHead className="text-right">Freight</TableHead>}
              {hasFreight && <TableHead className="text-right">Landed / unit</TableHead>}
              <TableHead>Shipment</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.purchases.map((line) => {
              const extras = lineExtrasUsd(line)
              const freight = lineFreight(line)
              const shipment = line.batches.find((b) => b.shipment)?.shipment
              return (
                <TableRow key={line.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/products/${line.product.id}`}
                      className="hover:underline underline-offset-2"
                    >
                      {line.product.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {line.product.sku}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatUsd(line.unitPriceUsd)}
                    <span className="ml-1 text-xs">× {line.quantity}</span>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {extras > 0 ? `+ ${formatUsd(extras)}` : '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatUsd(line.unitCostUsd)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatUsd(line.totalCostUsd)}
                  </TableCell>
                  {hasFreight && (
                    <TableCell className="text-right text-muted-foreground">
                      {freight.totalUsd > 0
                        ? `${freight.isEstimate ? '~' : ''}${formatUsd(freight.totalUsd)}`
                        : '—'}
                    </TableCell>
                  )}
                  {hasFreight && (
                    <TableCell className="text-right">
                      {formatUsd(line.unitCostUsd + freight.perUnitUsd)}
                    </TableCell>
                  )}
                  <TableCell>
                    {shipment ? (
                      <Link
                        href={`/shipments/${shipment.id}`}
                        className="text-sm hover:underline underline-offset-2"
                      >
                        {shipment.code}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <PurchaseStatusSelect purchaseId={line.id} status={line.status} />
                  </TableCell>
                </TableRow>
              )
            })}
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableCell className="font-medium">Order total</TableCell>
              <TableCell className="text-right font-medium">{summary.units}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatUsd(summary.goodsUsd)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {summary.extrasUsd > 0 ? `+ ${formatUsd(summary.extrasUsd)}` : '—'}
              </TableCell>
              <TableCell />
              <TableCell className="text-right font-semibold">
                {formatUsd(summary.totalUsd)}
              </TableCell>
              {hasFreight && (
                <TableCell className="text-right text-muted-foreground">
                  {formatUsd(summary.freightUsd)}
                </TableCell>
              )}
              {hasFreight && (
                <TableCell className="text-right font-semibold">
                  {formatUsd(summary.landedUsd)}
                </TableCell>
              )}
              <TableCell colSpan={2} />
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <p className="mt-4 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Unit cost</span> is what one unit cost with
        this order&rsquo;s extras folded in
        {summary.extrasUsd > 0
          ? ` — ${formatUsd(order.taxUsd)} tax and ${formatUsd(order.shippingUsd)} shipping, each item taking a share proportional to its value.`
          : ', but no tax or shipping was recorded for this order, so it is just the price paid.'}
        {hasFreight
          ? ' Landed adds the USA → Argentina courier bill from the shipment.'
          : ' The USA → Argentina freight is added later, when the shipment is costed.'}
      </p>
    </div>
  )
}
