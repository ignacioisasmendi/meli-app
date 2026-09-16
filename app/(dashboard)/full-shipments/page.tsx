import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { StatusBadge } from '@/components/dashboard/status-badge'
import { FullShipmentFormDialog } from '@/components/full-shipments/full-shipment-form-dialog'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function FullShipmentsPage() {
  const t = await getTranslations('FullShipments')

  const [fullShipments, accounts] = await Promise.all([
    prisma.fullShipment.findMany({
      include: {
        account: { select: { nickname: true } },
        shipments: { include: { batches: { select: { quantity: true } } } },
      },
      orderBy: [{ status: 'asc' }, { sentAt: 'desc' }],
      take: 100,
    }),
    prisma.mercadoLibreAccount.findMany({
      where: { isActive: true },
      select: { id: true, nickname: true },
      orderBy: { nickname: 'asc' },
    }),
  ])

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={<FullShipmentFormDialog accounts={accounts} />}
      />

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inboundId')}</TableHead>
              <TableHead>{t('account')}</TableHead>
              <TableHead className="text-right">{t('shipments')}</TableHead>
              <TableHead className="text-right">{t('units')}</TableHead>
              <TableHead>{t('sent')}</TableHead>
              <TableHead>{t('received')}</TableHead>
              <TableHead>{t('status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fullShipments.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {t('noneYet')}
                </TableCell>
              </TableRow>
            )}
            {fullShipments.map((fs) => {
              const units = fs.shipments.reduce(
                (n, s) => n + s.batches.reduce((m, b) => m + b.quantity, 0),
                0
              )
              return (
                <TableRow key={fs.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/full-shipments/${fs.id}`}
                      className="hover:underline underline-offset-2"
                    >
                      {fs.mlInboundId}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{fs.account.nickname}</TableCell>
                  <TableCell className="text-right">{fs.shipments.length}</TableCell>
                  <TableCell className="text-right">{units}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(fs.sentAt)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {fs.receivedAt ? formatDate(fs.receivedAt) : '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={fs.status} />
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
