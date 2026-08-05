import { ShipmentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { PurchaseImport } from '@/components/purchases/purchase-import'

export const dynamic = 'force-dynamic'

export default async function ImportPurchasesPage() {
  const [products, shipments] = await Promise.all([
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
  ])

  return (
    <div>
      <PageHeader
        title="Import purchases"
        description="Fill this in from an Amazon order screenshot, or enter the items by hand — tax + shipping are split across items into each per-unit landed cost."
      />
      <PurchaseImport
        products={products}
        shipments={shipments}
        canUploadScreenshot={Boolean(process.env.ANTHROPIC_API_KEY)}
      />
    </div>
  )
}
