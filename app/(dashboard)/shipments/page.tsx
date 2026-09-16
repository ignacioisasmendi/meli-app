import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { ShipmentFormDialog } from '@/components/shipments/shipment-form-dialog'
import { ShipmentStatusSelect } from '@/components/shipments/shipment-status-select'
import { Badge } from '@/components/ui/badge'
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
import { shipmentBill } from '@/lib/inventory/shipment'

export const dynamic = 'force-dynamic'

export default async function ShipmentsPage() {
  const t = await getTranslations('Shipments')
  const tBasis = await getTranslations('AllocationBasis')
  const tStatus = await getTranslations('Status')
  const shipments = await prisma.shipment.findMany({
    include: {
      batches: { select: { quantity: true, goodsUnitCostUsd: true } },
    },
    orderBy: [{ costedAt: 'asc' }, { createdAt: 'desc' }],
    take: 100,
  })

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={<ShipmentFormDialog />}
      />

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('code')}</TableHead>
              <TableHead>{t('courier')}</TableHead>
              <TableHead className="text-right">{t('units')}</TableHead>
              <TableHead className="text-right">{t('goods')}</TableHead>
              <TableHead className="text-right">{t('freight')}</TableHead>
              <TableHead>{t('split')}</TableHead>
              <TableHead>{t('status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shipments.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {t('noShipmentsYet')}
                </TableCell>
              </TableRow>
            )}
            {shipments.map((s) => {
              const units = s.batches.reduce((n, b) => n + b.quantity, 0)
              const goods = s.batches.reduce((n, b) => n + b.quantity * b.goodsUnitCostUsd, 0)
              const bill = shipmentBill(s)
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    <Link href={`/shipments/${s.id}`} className="hover:underline underline-offset-2">
                      {s.code}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatDate(s.createdAt)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.courier ?? '—'}</TableCell>
                  <TableCell className="text-right">{units}</TableCell>
                  <TableCell className="text-right">{formatUsd(goods)}</TableCell>
                  <TableCell className="text-right">
                    {bill > 0 ? (
                      formatUsd(bill)
                    ) : s.estimatedUsd > 0 ? (
                      <span className="text-muted-foreground">
                        {t('estimateValue', { value: formatUsd(s.estimatedUsd) })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {tBasis(s.basis)}
                  </TableCell>
                  <TableCell>
                    {s.status === 'COSTED' ? (
                      <Badge
                        variant="secondary"
                        className="border-transparent bg-emerald-100 font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      >
                        {tStatus('COSTED')}
                      </Badge>
                    ) : (
                      <ShipmentStatusSelect shipmentId={s.id} status={s.status} />
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
