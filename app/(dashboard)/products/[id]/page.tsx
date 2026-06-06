import { notFound } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { ProductFormDialog } from '@/components/products/product-form-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime, formatUsd } from '@/lib/utils'
import { getInTransit, stockViewFrom } from '@/lib/inventory/stock'
import { StatusBadge } from '@/components/dashboard/status-badge'

export const dynamic = 'force-dynamic'

const STAT = (label: string, value: string | number) => ({ label, value })

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      batches: { orderBy: { purchasedAt: 'desc' } },
      movements: { orderBy: { createdAt: 'desc' }, take: 50 },
    },
  })
  if (!product) notFound()

  const view = stockViewFrom(product, await getInTransit(product.id))
  const stats = [
    STAT('Available', view.available),
    STAT('In transit', view.inTransit),
    STAT('Reserved', view.reserved),
    STAT('Total purchased', product.totalPurchased),
    STAT('Total sold', product.totalSold),
    STAT('Avg cost', formatUsd(product.averageCostUsd)),
  ]

  return (
    <div>
      <PageHeader
        title={product.name}
        description={`SKU ${product.sku}${product.brand ? ` · ${product.brand}` : ''}`}
        action={
          <ProductFormDialog
            product={product}
            trigger={
              <Button variant="outline">
                <Pencil className="size-4" />
                Edit
              </Button>
            }
          />
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-2xl font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Inventory batches</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Qty</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead>Unit cost</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.batches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      No batches.
                    </TableCell>
                  </TableRow>
                )}
                {product.batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.quantity}</TableCell>
                    <TableCell>{b.remainingQuantity}</TableCell>
                    <TableCell>{formatUsd(b.unitCostUsd)}</TableCell>
                    <TableCell>
                      <StatusBadge status={b.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Movement history</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.movements.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      No movements.
                    </TableCell>
                  </TableRow>
                )}
                {product.movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(m.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{m.type}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
