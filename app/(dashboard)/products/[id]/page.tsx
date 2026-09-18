import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Pencil } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { ProductFormDialog } from '@/components/products/product-form-dialog'
import { ProductThumb } from '@/components/products/product-thumb'
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
import { getInFull, getInTransit, stockViewFrom } from '@/lib/inventory/stock'
import { StatusBadge } from '@/components/dashboard/status-badge'
import { BatchStatusSelect } from '@/components/inventory/batch-status-select'

export const dynamic = 'force-dynamic'

const STAT = (label: string, value: string | number) => ({ label, value })

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const t = await getTranslations('ProductDetail')
  const tMove = await getTranslations('MovementType')
  const { id } = await params
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      batches: {
        include: { shipment: { select: { id: true, code: true } } },
        orderBy: { purchasedAt: 'desc' },
      },
      movements: { orderBy: { createdAt: 'desc' }, take: 50 },
    },
  })
  if (!product) notFound()

  const [inTransit, inFull] = await Promise.all([
    getInTransit(product.id),
    getInFull(product.id),
  ])
  const view = stockViewFrom(product, inTransit, inFull)
  const stats = [
    STAT(t('inTransit'), view.inTransit),
    STAT(t('received'), view.received),
    STAT(t('full'), view.full),
    STAT(t('reserved'), view.reserved),
    STAT(t('totalPurchased'), product.totalPurchased),
    STAT(t('totalSold'), product.totalSold),
    STAT(t('avgCost'), formatUsd(product.averageCostUsd)),
    STAT(t('weight'), product.weightGrams != null ? `${product.weightGrams} g` : '—'),
  ]

  return (
    <div>
      <PageHeader
        title={product.name}
        description={t('skuDescription', { sku: product.sku, brand: product.brand ? ` · ${product.brand}` : '' })}
        leading={<ProductThumb src={product.imageUrl} alt="" size={56} />}
        action={
          <ProductFormDialog
            product={{
              id: product.id,
              sku: product.sku,
              name: product.name,
              brand: product.brand,
              minStock: product.minStock,
              weightGrams: product.weightGrams,
            }}
            trigger={
              <Button variant="outline">
                <Pencil className="size-4" />
                {t('edit')}
              </Button>
            }
          />
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
            <CardTitle>{t('inventoryBatches')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('qty')}</TableHead>
                  <TableHead>{t('remaining')}</TableHead>
                  <TableHead>{t('landedCost')}</TableHead>
                  <TableHead>{t('shipment')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.batches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {t('noBatches')}
                    </TableCell>
                  </TableRow>
                )}
                {product.batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.quantity}</TableCell>
                    <TableCell>{b.remainingQuantity}</TableCell>
                    <TableCell>
                      {formatUsd(b.unitCostUsd)}
                      {b.freightUnitCostUsd > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {formatUsd(b.goodsUnitCostUsd)} + {formatUsd(b.freightUnitCostUsd)}{' '}
                          {t('freight')}
                          {b.freightIsEstimate && ` ${t('estimateSuffix')}`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {b.shipment ? (
                        <Link
                          href={`/shipments/${b.shipment.id}`}
                          className="text-sm hover:underline underline-offset-2"
                        >
                          {b.shipment.code}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* Stock loaded without a purchase has nothing else driving its status. */}
                      {!b.purchaseId && !b.shipmentId && !b.fullShipmentId ? (
                        <BatchStatusSelect batchId={b.id} status={b.status} />
                      ) : (
                        <StatusBadge status={b.status} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('movementHistory')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('when')}</TableHead>
                  <TableHead>{t('type')}</TableHead>
                  <TableHead className="text-right">{t('qty')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.movements.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      {t('noMovements')}
                    </TableCell>
                  </TableRow>
                )}
                {product.movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(m.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{tMove(m.type)}</Badge>
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
