import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatArs, formatDateTime, formatUsd } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function SalesPage() {
  const sales = await prisma.sale.findMany({
    include: {
      product: { select: { name: true, sku: true } },
      account: { select: { nickname: true } },
    },
    orderBy: { soldAt: 'desc' },
    take: 200,
  })

  return (
    <div>
      <PageHeader
        title="Sales"
        description="Orders imported automatically from Mercado Libre."
      />

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
            {sales.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No sales yet.
                </TableCell>
              </TableRow>
            )}
            {sales.map((s) => (
              <TableRow key={s.id}>
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
                <TableCell className="text-right">{s.quantity}</TableCell>
                <TableCell className="text-right">{formatArs(s.salePriceArs)}</TableCell>
                <TableCell className="text-right">
                  <span
                    className={
                      s.profitUsd >= 0
                        ? 'font-medium text-emerald-600 dark:text-emerald-400'
                        : 'font-medium text-destructive'
                    }
                  >
                    {formatUsd(s.profitUsd)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
