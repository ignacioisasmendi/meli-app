import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Pencil } from 'lucide-react'
import { FullShipmentStatus } from '@prisma/client'
import { PageHeader } from '@/components/dashboard/page-header'
import { StatusBadge } from '@/components/dashboard/status-badge'
import { AssignShipmentsDialog } from '@/components/full-shipments/assign-shipments-dialog'
import { FullShipmentFormDialog } from '@/components/full-shipments/full-shipment-form-dialog'
import { MarkReceivedButton } from '@/components/full-shipments/mark-received-button'
import { RemoveShipmentButton } from '@/components/full-shipments/remove-shipment-button'
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
import { formatDate } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { getFullShipment } from '@/lib/inventory/full-shipments'
import { aggregateFullShipmentLines } from '@/lib/inventory/full-shipment-lines'

export const dynamic = 'force-dynamic'

export default async function FullShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const t = await getTranslations('FullShipmentDetail')
  const [fullShipment, accounts] = await Promise.all([
    getFullShipment((await params).id),
    prisma.mercadoLibreAccount.findMany({
      where: { isActive: true },
      select: { id: true, nickname: true },
      orderBy: { nickname: 'asc' },
    }),
  ])
  if (!fullShipment) notFound()

  const received = fullShipment.status === FullShipmentStatus.RECEIVED
  const units = fullShipment.shipments.reduce(
    (n, s) => n + s.batches.reduce((m, b) => m + b.quantity, 0),
    0
  )
  const lines = aggregateFullShipmentLines(fullShipment.shipments)

  const stats = [
    { label: t('status'), value: <StatusBadge status={fullShipment.status} /> },
    { label: t('shipments'), value: fullShipment.shipments.length },
    { label: t('units'), value: units },
    { label: t('sentAt'), value: formatDate(fullShipment.sentAt) },
    { label: t('receivedAt'), value: fullShipment.receivedAt ? formatDate(fullShipment.receivedAt) : '—' },
  ]

  return (
    <div>
      <PageHeader
        title={fullShipment.mlInboundId}
        description={received ? t('receivedDescription') : t('sentDescription')}
        action={
          <div className="flex gap-2">
            {!received && (
              <>
                <MarkReceivedButton fullShipmentId={fullShipment.id} />
                <AssignShipmentsDialog fullShipmentId={fullShipment.id} />
              </>
            )}
            <FullShipmentFormDialog
              accounts={accounts}
              fullShipment={{
                id: fullShipment.id,
                accountId: fullShipment.accountId,
                mlInboundId: fullShipment.mlInboundId,
                sentAt: fullShipment.sentAt,
                notes: fullShipment.notes,
              }}
              trigger={
                <Button variant="outline">
                  <Pencil className="size-4" />
                  {t('edit')}
                </Button>
              }
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

      {fullShipment.notes && (
        <Card className="mb-6">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {fullShipment.notes}
          </CardContent>
        </Card>
      )}

      <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t('shipmentsIncluded')}</h2>
      <Card className="mb-6 overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('code')}</TableHead>
              <TableHead>{t('courier')}</TableHead>
              <TableHead className="text-right">{t('units')}</TableHead>
              {!received && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {fullShipment.shipments.length === 0 && (
              <TableRow>
                <TableCell colSpan={received ? 3 : 4} className="py-8 text-center text-muted-foreground">
                  {t('noShipmentsIncluded')}
                </TableCell>
              </TableRow>
            )}
            {fullShipment.shipments.map((s) => {
              const shipmentUnits = s.batches.reduce((n, b) => n + b.quantity, 0)
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    <Link href={`/shipments/${s.id}`} className="hover:underline underline-offset-2">
                      {s.code}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.courier ?? '—'}</TableCell>
                  <TableCell className="text-right">{shipmentUnits}</TableCell>
                  {!received && (
                    <TableCell>
                      <RemoveShipmentButton shipmentId={s.id} />
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t('whatIsGoing')}</h2>
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('product')}</TableHead>
              <TableHead>{t('sku')}</TableHead>
              <TableHead className="text-right">{t('units')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  {t('noShipmentsIncluded')}
                </TableCell>
              </TableRow>
            )}
            {lines.map((line) => (
              <TableRow key={line.productId}>
                <TableCell className="font-medium">{line.productName}</TableCell>
                <TableCell className="text-muted-foreground">{line.sku}</TableCell>
                <TableCell className="text-right">{line.quantity}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
