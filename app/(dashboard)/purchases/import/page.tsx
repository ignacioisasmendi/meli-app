import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { PurchaseImport } from '@/components/purchases/purchase-import'

export const dynamic = 'force-dynamic'

export default async function ImportPurchasesPage() {
  const products = await prisma.product.findMany({
    where: { archived: false },
    select: { id: true, name: true, sku: true },
    orderBy: { name: 'asc' },
  })

  return (
    <div>
      <PageHeader
        title="Import purchases"
        description="Enter an order's items, tax and shipping — tax + shipping are split across items into each per-unit landed cost."
      />
      <PurchaseImport products={products} />
    </div>
  )
}
