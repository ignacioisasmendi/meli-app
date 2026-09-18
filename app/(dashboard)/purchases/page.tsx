import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Import } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { ArrivalDialog } from '@/components/purchases/arrival-dialog'
import { PurchaseFormDialog } from '@/components/purchases/purchase-form-dialog'
import { PurchaseStatusSelect } from '@/components/purchases/purchase-status-select'
import { Button } from '@/components/ui/button'
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
import { listPurchaseLines, unitPriceWithTaxUsd } from '@/lib/purchases'

export const dynamic = 'force-dynamic'

export default async function PurchasesPage() {
  const t = await getTranslations('Purchases')
  const [lines, products] = await Promise.all([
    listPurchaseLines(),
    prisma.product.findMany({
      where: { archived: false },
      select: { id: true, name: true, sku: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/purchases/import">
                <Import className="size-4" />
                {t('importOrder')}
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
              <TableHead>{t('date')}</TableHead>
              <TableHead>{t('arrivedAt')}</TableHead>
              <TableHead>{t('order')}</TableHead>
              <TableHead>{t('product')}</TableHead>
              <TableHead className="text-right">{t('qty')}</TableHead>
              <TableHead className="text-right">{t('unitPrice')}</TableHead>
              <TableHead>{t('status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {t('noPurchasesYet')}
                </TableCell>
              </TableRow>
            )}
            {lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="text-muted-foreground">
                  {formatDate(line.purchasedAt)}
                </TableCell>
                <TableCell>
                  <ArrivalDialog
                    purchaseId={line.id}
                    productName={line.product.name}
                    quantity={line.quantity}
                    arrivedAt={line.arrivedAt ? line.arrivedAt.toISOString().slice(0, 10) : null}
                    arrivedAtLabel={line.arrivedAt ? formatDate(line.arrivedAt) : null}
                  />
                </TableCell>
                <TableCell>
                  {line.order ? (
                    <Link
                      href={`/purchases/orders/${line.order.id}`}
                      className="font-mono text-xs hover:underline underline-offset-2"
                    >
                      {line.order.orderNumber}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {line.order?.supplier ?? line.supplier ?? ''}
                  </span>
                </TableCell>
                <TableCell className="font-medium">
                  <Link
                    href={`/products/${line.product.id}`}
                    className="hover:underline underline-offset-2"
                  >
                    {line.product.name}
                  </Link>
                  <span className="block font-mono text-xs font-normal text-muted-foreground">
                    {line.product.sku}
                  </span>
                </TableCell>
                <TableCell className="text-right">{line.quantity}</TableCell>
                <TableCell className="text-right">
                  {formatUsd(unitPriceWithTaxUsd(line))}
                  {line.taxUsd > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      {t('priceWithTax', {
                        price: formatUsd(line.unitPriceUsd),
                        tax: formatUsd(line.taxUsd / Math.max(1, line.quantity)),
                      })}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <PurchaseStatusSelect purchaseId={line.id} status={line.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
