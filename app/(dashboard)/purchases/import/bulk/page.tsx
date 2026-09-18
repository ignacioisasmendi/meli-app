import { getTranslations } from 'next-intl/server'
import { ShipmentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { BulkOrderImport } from '@/components/purchases/bulk-order-import'

export const dynamic = 'force-dynamic'

export default async function BulkImportPurchasesPage() {
  const t = await getTranslations('BulkOrderImport')
  const [products, shipments, orders] = await Promise.all([
    prisma.product.findMany({
      where: { archived: false },
      select: { id: true, name: true, sku: true },
      orderBy: { name: 'asc' },
    }),
    prisma.shipment.findMany({
      where: { status: { not: ShipmentStatus.COSTED } },
      select: { id: true, code: true, courier: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.purchaseOrder.findMany({ select: { supplier: true, orderNumber: true } }),
  ])

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />
      <BulkOrderImport
        products={products}
        shipments={shipments}
        existingOrderKeys={orders.map((o) => `${o.supplier.trim().toLowerCase()}|${o.orderNumber.trim()}`)}
      />
    </div>
  )
}
