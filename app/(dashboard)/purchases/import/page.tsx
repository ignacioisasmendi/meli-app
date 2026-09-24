import Link from 'next/link'
import { Files } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { ImportDraftStatus, ShipmentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { Button } from '@/components/ui/button'
import { ImportDrafts } from '@/components/purchases/import-drafts'
import { PurchaseImport, type ImportDraftInput } from '@/components/purchases/purchase-import'
import type { OrderWarning, ParsedOrder } from '@/lib/imports/amazon-order'

export const dynamic = 'force-dynamic'

export default async function ImportPurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>
}) {
  const t = await getTranslations('PurchaseImport')
  const { draft: draftId } = await searchParams
  const [products, shipments, drafts] = await Promise.all([
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
    // Orders captured by the browser extension, waiting for review.
    prisma.importDraft.findMany({
      where: { status: ImportDraftStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ])

  const draftRow = draftId ? drafts.find((d) => d.id === draftId) : undefined
  let draft: ImportDraftInput | undefined
  if (draftRow) {
    const order = draftRow.order as unknown as ParsedOrder
    // ASINs imported before already know their product — no guessing by name.
    const asins = order.items.map((i) => i.asin).filter((a): a is string => !!a)
    const aliases = asins.length
      ? await prisma.productAlias.findMany({
          where: { supplier: draftRow.supplier, externalId: { in: asins } },
          select: { externalId: true, productId: true },
        })
      : []
    draft = {
      id: draftRow.id,
      order,
      warnings: draftRow.warnings as unknown as OrderWarning[],
      knownAsins: Object.fromEntries(aliases.map((a) => [a.externalId, a.productId])),
    }
  }

  return (
    <div className="space-y-6">
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
      {draftId && !draft && (
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          {t('draftUnavailable')}
        </p>
      )}
      {drafts.length > 0 && (
        <ImportDrafts
          activeId={draft?.id}
          drafts={drafts.map((d) => {
            const order = d.order as unknown as ParsedOrder
            return {
              id: d.id,
              orderNumber: d.orderNumber,
              itemCount: order.items.length,
              grandTotal: order.grandTotal,
              warningCount: (d.warnings as unknown as OrderWarning[]).length,
              sourceUrl: d.sourceUrl,
              createdAt: d.createdAt.toISOString(),
            }
          })}
        />
      )}
      <PurchaseImport
        // Remount per draft, so switching drafts starts from a clean form.
        key={draft?.id ?? 'blank'}
        products={products}
        shipments={shipments}
        canUploadScreenshot={Boolean(process.env.ANTHROPIC_API_KEY)}
        draft={draft}
      />
    </div>
  )
}
