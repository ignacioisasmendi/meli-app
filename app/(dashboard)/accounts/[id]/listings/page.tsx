import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { ListingLinkSelect } from '@/components/accounts/listing-link-select'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const dynamic = 'force-dynamic'

export default async function ListingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const t = await getTranslations('AccountListings')
  const { id } = await params
  const account = await prisma.mercadoLibreAccount.findUnique({ where: { id } })
  if (!account) notFound()

  const [listings, products] = await Promise.all([
    prisma.mlListing.findMany({
      where: { accountId: id },
      orderBy: [{ productId: 'asc' }, { title: 'asc' }],
    }),
    prisma.product.findMany({
      where: { archived: false },
      select: { id: true, name: true, sku: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <div>
      <PageHeader
        title={t('listingsTitle', { nickname: account.nickname })}
        description={t('description')}
      />

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('item')}</TableHead>
              <TableHead>{t('mlSku')}</TableHead>
              <TableHead>{t('linkedProduct')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listings.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                  {t('noListingsImported')}
                </TableCell>
              </TableRow>
            )}
            {listings.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">
                  {l.title ?? l.mlItemId}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {l.mlItemId}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {l.sku ?? '—'}
                </TableCell>
                <TableCell>
                  <ListingLinkSelect
                    listingId={l.id}
                    productId={l.productId}
                    products={products}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
