import Link from 'next/link'
import { Files } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { ShipmentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { Button } from '@/components/ui/button'
import { PurchaseImport } from '@/components/purchases/purchase-import'

export const dynamic = 'force-dynamic'

export default async function ImportPurchasesPage() {
  const t = await getTranslations('PurchaseImport')
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
        title={t('title')}
        description={t('description')}
        action={
          <Button asChild variant="outline">
            <Link href="/purchases/import/bulk">
              <Files className="size-4" />
              {t('bulkImport')}
            </Link>
          </Button>
        }
      />
      <PurchaseImport
        products={products}
        shipments={shipments}
        canUploadScreenshot={Boolean(process.env.ANTHROPIC_API_KEY)}
      />
    </div>
  )
}
