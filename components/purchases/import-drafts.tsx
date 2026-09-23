'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ExternalLink, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatDateTime, formatUsd } from '@/lib/utils'
import { discardImportDraft } from '@/actions/imports'

export interface ImportDraftSummary {
  id: string
  orderNumber: string | null
  itemCount: number
  grandTotal: number | null
  warningCount: number
  sourceUrl: string | null
  createdAt: string
}

/**
 * Orders the browser extension captured and nobody has imported yet. Each one
 * opens pre-filled in the form below; discarding drops it without touching
 * stock (a personal purchase, a duplicate).
 */
export function ImportDrafts({
  drafts,
  activeId,
}: {
  drafts: ImportDraftSummary[]
  /** The draft currently loaded in the form, highlighted in the list. */
  activeId?: string
}) {
  const t = useTranslations('ImportDrafts')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function onDiscard(id: string) {
    startTransition(async () => {
      const res = await discardImportDraft(id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(t('discarded'))
      if (id === activeId) router.push('/purchases/import')
      else router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title', { count: drafts.length })}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {drafts.map((d) => (
          <div
            key={d.id}
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3',
              d.id === activeId && 'border-primary bg-muted/50'
            )}
          >
            <div className="min-w-0 text-sm">
              <div className="font-medium">
                {d.orderNumber ? t('order', { orderNumber: d.orderNumber }) : t('noOrderNumber')}
              </div>
              <div className="text-muted-foreground">
                {t('itemCount', { count: d.itemCount })}
                {d.grandTotal != null && ` · ${formatUsd(d.grandTotal)}`}
                {` · ${t('captured', { date: formatDateTime(d.createdAt) })}`}
              </div>
              {d.warningCount > 0 && (
                <div className="mt-1 flex items-center gap-1 text-amber-600 dark:text-amber-500">
                  <AlertTriangle className="size-3.5" />
                  {t('warnings', { count: d.warningCount })}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {d.sourceUrl && (
                <Button asChild variant="ghost" size="icon" className="size-8" title={t('openOnAmazon')}>
                  <a href={d.sourceUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title={t('discard')}
                disabled={pending}
                onClick={() => onDiscard(d.id)}
              >
                <Trash2 className="size-4" />
              </Button>
              {d.id !== activeId && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/purchases/import?draft=${d.id}`}>{t('review')}</Link>
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
