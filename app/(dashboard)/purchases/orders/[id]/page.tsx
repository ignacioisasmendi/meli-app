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
import { getPurchaseOrder, lineCosts, summarizeOrder } from '@/lib/purchases'

export const dynamic = 'force-dynamic'

/** One term of the running sum across the top of the page. */
function Term({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${muted ? 'text-muted-foreground' : ''}`}>{value}</p>
    </div>
  )
}

function Operator({ children }: { children: React.ReactNode }) {
  return <span className="pb-0.5 self-end text-lg text-muted-foreground">{children}</span>
}

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const order = await getPurchaseOrder(id)
  if (!order) notFound()

  const summary = summarizeOrder(order.purchases)
  // Freight columns only earn their space once a shipment has been costed.
  const hasFreight = summary.freightUsd > 0

  return (
    <div>
      <PageHeader
        title={order.orderNumber}
        description={`${order.supplier} · ${formatDate(order.purchasedAt)} · ${summary.lineCount} product${summary.lineCount === 1 ? '' : 's'}, ${summary.units} unit${summary.units === 1 ? '' : 's'}`}
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

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <Term label="Products" value={formatUsd(summary.goodsUsd)} />
          <Operator>+</Operator>
          <Term label="Tax" value={formatUsd(summary.taxUsd)} />
          <Operator>+</Operator>
          <Term label="Shipping" value={formatUsd(summary.shippingUsd)} />
          <Operator>=</Operator>
          <Term label="Order total" value={formatUsd(summary.totalUsd)} />
          {hasFreight && (
            <>
              <Operator>+</Operator>
              <Term
                label={summary.freightIsEstimate ? 'Import freight (est.)' : 'Import freight'}
                value={formatUsd(summary.freightUsd)}
                muted
              />
              <Operator>=</Operator>
              <Term label="Landed" value={formatUsd(summary.landedUsd)} />
            </>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Product price</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <TableHead className="text-right">Shipping</TableHead>
              <TableHead className="text-right">Total</TableHead>
              {hasFreight && <TableHead className="text-right">Import freight</TableHead>}
              {hasFreight && <TableHead className="text-right">Landed</TableHead>}
              <TableHead>Shipment</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.purchases.map((line) => {
              const c = lineCosts(line)
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
                  <TableCell className="text-right">
                    {formatUsd(c.goodsUsd)}
                    <span className="block text-xs text-muted-foreground">
                      {formatUsd(line.unitPriceUsd)} ea
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.taxUsd > 0 ? formatUsd(c.taxUsd) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.shippingUsd > 0 ? formatUsd(c.shippingUsd) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatUsd(c.totalUsd)}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {formatUsd(c.unitCostUsd)} ea
                    </span>
                  </TableCell>
                  {hasFreight && (
                    <TableCell className="text-right text-muted-foreground">
                      {c.freightUsd > 0
                        ? `${c.freightIsEstimate ? '~' : ''}${formatUsd(c.freightUsd)}`
                        : '—'}
                    </TableCell>
                  )}
                  {hasFreight && (
                    <TableCell className="text-right font-medium">
                      {formatUsd(c.landedUsd)}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {formatUsd(c.landedUnitUsd)} ea
                      </span>
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
              <TableCell className="text-right font-medium">
                {formatUsd(summary.goodsUsd)}
              </TableCell>
              <TableCell className="text-right font-medium">{formatUsd(summary.taxUsd)}</TableCell>
              <TableCell className="text-right font-medium">
                {formatUsd(summary.shippingUsd)}
              </TableCell>
              <TableCell className="text-right font-semibold">
                {formatUsd(summary.totalUsd)}
              </TableCell>
              {hasFreight && (
                <TableCell className="text-right font-medium text-muted-foreground">
                  {formatUsd(summary.freightUsd)}
                </TableCell>
              )}
              {hasFreight && (
                <TableCell className="text-right font-semibold">
                  {formatUsd(summary.landedUsd)}
                </TableCell>
              )}
              {/* Shipment + Status */}
              <TableCell colSpan={2} />
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <p className="mt-4 text-sm text-muted-foreground">
        {summary.taxUsd + summary.shippingUsd > 0
          ? `The order’s ${formatUsd(order.taxUsd)} tax and ${formatUsd(order.shippingUsd)} shipping are split across the products by value, so each one carries its own share.`
          : 'No tax or shipping was recorded for this order, so each product’s total is just the price paid.'}
        {hasFreight
          ? ' Landed adds the USA → Argentina courier bill from the shipment.'
          : ' The USA → Argentina freight is added later, when the shipment is costed.'}
      </p>
    </div>
  )
}
