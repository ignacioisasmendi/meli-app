import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Plus, Store, AlertTriangle } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/dashboard/page-header'
import { AccountActions } from '@/components/accounts/account-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  const t = await getTranslations('Accounts')
  const accounts = await prisma.mercadoLibreAccount.findMany({
    where: { isActive: true },
    orderBy: { nickname: 'asc' },
    include: {
      _count: { select: { listings: true, sales: true } },
    },
  })

  const unmappedByAccount = await prisma.mlListing.groupBy({
    by: ['accountId'],
    where: { productId: null },
    _count: { _all: true },
  })
  const unmapped = new Map(unmappedByAccount.map((u) => [u.accountId, u._count._all]))

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={
          <Button asChild>
            <a href="/api/mercadolibre/connect">
              <Plus className="size-4" />
              {t('connectAccount')}
            </a>
          </Button>
        }
      />

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Store className="size-10 text-muted-foreground" />
            <p className="text-muted-foreground">{t('noAccountsYet')}</p>
            <Button asChild>
              <a href="/api/mercadolibre/connect">{t('connectFirstAccount')}</a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {accounts.map((a) => {
            const unmappedCount = unmapped.get(a.id) ?? 0
            return (
              <Card key={a.id}>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Store className="size-5" />
                    {a.nickname}
                  </CardTitle>
                  <Badge variant="secondary">ML #{a.mlUserId}</Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-6 text-sm">
                    <div>
                      <p className="text-muted-foreground">{t('listings')}</p>
                      <p className="text-lg font-semibold">{a._count.listings}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('sales')}</p>
                      <p className="text-lg font-semibold">{a._count.sales}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('tokenExpires')}</p>
                      <p className="text-sm">{formatDateTime(a.expiresAt)}</p>
                    </div>
                  </div>

                  {unmappedCount > 0 && (
                    <div className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      <AlertTriangle className="size-4" />
                      {t('unmappedListings', { count: unmappedCount })} —{' '}
                      <Link href={`/accounts/${a.id}/listings`} className="font-medium underline">
                        {t('mapToProducts')}
                      </Link>
                    </div>
                  )}

                  <AccountActions accountId={a.id} />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
