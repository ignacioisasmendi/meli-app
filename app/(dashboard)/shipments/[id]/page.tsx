import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Pencil } from 'lucide-react'
import { ShipmentStatus } from '@prisma/client'
import { PageHeader } from '@/components/dashboard/page-header'
import { AssignBatchesDialog } from '@/components/shipments/assign-batches-dialog'
import { ShipmentCosting } from '@/components/shipments/shipment-costing'
import { ShipmentFormDialog } from '@/components/shipments/shipment-form-dialog'
import { ShipmentStatusSelect } from '@/components/shipments/shipment-status-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { getShipment } from '@/lib/inventory/shipment-costing'
import { getUsdArsRate } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export default async function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const t = await getTranslations('ShipmentDetail')
  const tStatus = await getTranslations('Status')
  const { id } = await params
  const [shipment, usdArsRate] = await Promise.all([getShipment(id), getUsdArsRate()])
  if (!shipment) notFound()

  const costed = shipment.status === ShipmentStatus.COSTED
  const stats = [
    { label: t('status'), value: tStatus(shipment.status) },
    { label: t('purchases'), value: shipment.batches.length },
    { label: t('departed'), value: shipment.departedAt ? formatDate(shipment.departedAt) : '—' },
    { label: t('arrived'), value: shipment.arrivedAt ? formatDate(shipment.arrivedAt) : '—' },
    { label: t('costed'), value: shipment.costedAt ? formatDate(shipment.costedAt) : '—' },
  ]

  return (
    <div>
      <PageHeader
        title={shipment.code}
        description={costed ? t('costedDescription') : t('openDescription')}
        action={
          <div className="flex gap-2">
            {!costed && (
              <>
                <ShipmentStatusSelect shipmentId={shipment.id} status={shipment.status} />
                <AssignBatchesDialog shipmentId={shipment.id} />
              </>
            )}
            <ShipmentFormDialog
              shipment={{
                id: shipment.id,
                code: shipment.code,
                courier: shipment.courier,
                basis: shipment.basis,
                estimatedUsd: shipment.estimatedUsd,
                notes: shipment.notes,
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

      {shipment.notes && (
        <Card className="mb-6">
          <CardContent className="pt-6 text-sm text-muted-foreground">{shipment.notes}</CardContent>
        </Card>
      )}

      <ShipmentCosting
        shipmentId={shipment.id}
        status={shipment.status}
        basis={shipment.basis}
        estimatedUsd={shipment.estimatedUsd}
        freightUsd={shipment.freightUsd}
        customsUsd={shipment.customsUsd}
        otherUsd={shipment.otherUsd}
        localShippingArs={shipment.localShippingArs}
        localShippingRate={shipment.localShippingRate}
        usdArsRate={usdArsRate}
        batches={shipment.batches.map((b) => ({
          id: b.id,
          productId: b.productId,
          productName: b.product.name,
          sku: b.product.sku,
          weightGrams: b.product.weightGrams,
          quantity: b.quantity,
          goodsUnitCostUsd: b.goodsUnitCostUsd,
          unitCostUsd: b.unitCostUsd,
        }))}
      />
    </div>
  )
}
