import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { PurchaseFormDialog } from '@/components/purchases/purchase-form-dialog'
import { PurchaseStatusSelect } from '@/components/purchases/purchase-status-select'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate, formatUsd } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function PurchasesPage() {
  const [purchases, products] = await Promise.all([
    prisma.purchase.findMany({
      include: { product: { select: { name: true, sku: true } } },
      orderBy: { purchasedAt: 'desc' },
      take: 200,
    }),
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
        description="Register purchases and track shipments to availability."
        action={<PurchaseFormDialog products={products} />}
      />

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchases.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No purchases yet.
                </TableCell>
              </TableRow>
            )}
            {purchases.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="text-muted-foreground">
                  {formatDate(p.purchasedAt)}
                </TableCell>
                <TableCell className="font-medium">
                  {p.product.name}
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
                  <PurchaseStatusSelect purchaseId={p.id} status={p.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
