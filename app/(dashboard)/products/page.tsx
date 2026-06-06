import Link from 'next/link'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { SearchInput } from '@/components/dashboard/search-input'
import { ProductFormDialog } from '@/components/products/product-form-dialog'
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
import { formatUsd } from '@/lib/utils'
import { getInTransit, stockViewFrom } from '@/lib/inventory/stock'

export const dynamic = 'force-dynamic'

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const where: Prisma.ProductWhereInput = {
    archived: false,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { sku: { contains: q, mode: 'insensitive' } },
            { brand: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const products = await prisma.product.findMany({ where, orderBy: { name: 'asc' } })
  const views = await Promise.all(
    products.map(async (p) => stockViewFrom(p, await getInTransit(p.id)))
  )

  return (
    <div>
      <PageHeader
        title="Products"
        description="Your product catalog and live stock."
        action={<ProductFormDialog />}
      />

      <div className="mb-4">
        <SearchInput placeholder="Search by name, SKU or brand…" />
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">In transit</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead className="text-right">Avg cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No products yet.
                </TableCell>
              </TableRow>
            )}
            {products.map((p, i) => {
              const v = views[i]
              const low = v.available <= p.minStock
              return (
                <TableRow key={p.id} className="cursor-default">
                  <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/products/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.brand ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <span className={low ? 'font-semibold text-destructive' : ''}>
                      {v.available}
                    </span>
                    {low && (
                      <Badge variant="destructive" className="ml-2">
                        Low
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {v.inTransit}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {v.reserved}
                  </TableCell>
                  <TableCell className="text-right">{formatUsd(p.averageCostUsd)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
