import { SaleStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { StatusBadge } from '@/components/dashboard/status-badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ReceiveReturnDialog } from '@/components/sales/receive-return-dialog'
import { ReverseSaleDialog } from '@/components/sales/reverse-sale-dialog'
import { getPendingReturns, netProfitUsd, netRevenueArs } from '@/lib/inventory/returns'
import { formatArs, formatDateTime, formatUsd } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function SalesPage() {
  const [sales, pendingReturns] = await Promise.all([
    prisma.sale.findMany({
      include: {
        product: { select: { name: true, sku: true } },
        account: { select: { nickname: true } },
      },
      orderBy: { soldAt: 'desc' },
      take: 200,
    }),
    getPendingReturns(),
  ])

  return (
    <div>
      <PageHeader
        title="Sales"
        description="Orders imported automatically from Mercado Libre."
      />

      {pendingReturns.length > 0 && (
        <Card className="mb-6 overflow-hidden p-0">
          <div className="border-b px-6 py-4">
            <h2 className="font-semibold">Returns awaiting receipt</h2>
            <p className="text-sm text-muted-foreground">
              Revenue is already reversed. Stock comes back only once you confirm the
              goods arrived.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Refunded</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingReturns.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.product.name}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {r.product.sku}
                    </span>
                  </TableCell>
                  <TableCell>{r.account.nickname}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.reversalReason ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">{r.awaitingQuantity}</TableCell>
                  <TableCell className="text-right">{formatArs(r.refundedArs)}</TableCell>
                  <TableCell>
                    <ReceiveReturnDialog
                      saleId={r.id}
                      productName={r.product.name}
                      awaitingQuantity={r.awaitingQuantity}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Profit (USD)</TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No sales yet.
                </TableCell>
              </TableRow>
            )}
            {sales.map((s) => {
              const netQuantity = s.quantity - s.returnedQuantity
              const netProfit = netProfitUsd(s)
              const reversed = s.returnedQuantity > 0
              return (
                <TableRow key={s.id} className={reversed ? 'text-muted-foreground' : ''}>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(s.soldAt)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {s.product.name}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {s.product.sku}
                    </span>
                  </TableCell>
                  <TableCell>{s.account.nickname}</TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {netQuantity}
                    {/* Show what was struck off, not just the survivor. */}
                    {reversed && <span className="ml-1 text-xs">of {s.quantity}</span>}
                  </TableCell>
                  <TableCell className="text-right">{formatArs(netRevenueArs(s))}</TableCell>
                  <TableCell className="text-right">
                    <span
                      className={
                        netProfit >= 0
                          ? 'font-medium text-emerald-600 dark:text-emerald-400'
                          : 'font-medium text-destructive'
                      }
                    >
                      {formatUsd(netProfit)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {s.status === SaleStatus.CONFIRMED && (
                      <ReverseSaleDialog
                        saleId={s.id}
                        productName={s.product.name}
                        quantity={s.quantity}
                      />
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
