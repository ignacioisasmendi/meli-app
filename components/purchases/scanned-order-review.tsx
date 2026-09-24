'use client'

import { AlertTriangle, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate, formatUsd } from '@/lib/utils'
import type { OrderWarning, ParsedOrder } from '@/lib/imports/amazon-order'

interface Props {
  order: ParsedOrder
  warnings: OrderWarning[]
  onDismiss: () => void
}

/**
 * What was read off the screenshot, before anything is saved — line by line and
 * against the totals Amazon printed, so it can be checked against the original
 * at a glance. The form below stays the place to correct anything.
 */
export function ScannedOrderReview({ order, warnings, onDismiss }: Props) {
  const t = useTranslations('ScannedOrderReview')
  const lineSum = order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  const subtotalMismatch =
    order.itemsSubtotal != null && Math.abs(lineSum - order.itemsSubtotal) > 0.02

  function describeWarning(w: OrderWarning): string {
    switch (w.code) {
      case 'noItems':
        return t('warning.noItems')
      case 'subtotalMismatch':
        return t('warning.subtotalMismatch', {
          lineSum: formatUsd(w.lineSum),
          itemsSubtotal: formatUsd(w.itemsSubtotal),
        })
      case 'grandTotalMismatch':
        return t('warning.grandTotalMismatch', {
          computed: formatUsd(w.computed),
          grandTotal: formatUsd(w.grandTotal),
        })
      case 'unexpectedCurrency':
        return t('warning.unexpectedCurrency', { currency: w.currency })
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>{t('readFromScreenshot')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {[
              order.orderNumber ? t('orderNumberLabel', { orderNumber: order.orderNumber }) : t('noOrderNumberFound'),
              order.purchasedAt ? formatDate(order.purchasedAt) : t('noDateFound'),
              t('itemCount', { count: order.items.length }),
            ].join(' · ')}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={onDismiss}
          aria-label={t('dismiss')}
        >
          <X className="size-4" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {warnings.length > 0 && (
          <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">{t('checkAgainstScreenshot')}</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {warnings.map((w, i) => (
                  <li key={i}>{describeWarning(w)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('item')}</TableHead>
                <TableHead className="text-right">{t('qty')}</TableHead>
                <TableHead className="text-right">{t('unit')}</TableHead>
                <TableHead className="text-right">{t('lineTotal')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item, i) => (
                <TableRow key={`${item.name}-${i}`}>
                  <TableCell className="max-w-md">
                    <span className="font-medium">{item.name}</span>
                    {item.fullTitle !== item.name && (
                      <span className="block text-xs text-muted-foreground">{item.fullTitle}</span>
                    )}
                    {item.seller && (
                      <span className="block text-xs text-muted-foreground">
                        {t('soldBy', { seller: item.seller })}
                      </span>
                    )}
                    {item.asin && (
                      <span className="block font-mono text-xs text-muted-foreground">
                        ASIN {item.asin}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(item.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(item.quantity * item.unitPrice)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
          <Row label={t('items')}>
            <span className={subtotalMismatch ? 'text-amber-600' : undefined}>
              {formatUsd(lineSum)}
            </span>
            {subtotalMismatch && (
              <span className="text-xs text-muted-foreground">
                {' '}
                {t('screenshotValue', { value: formatUsd(order.itemsSubtotal!) })}
              </span>
            )}
          </Row>
          <Row label={t('tax')}>{order.tax != null ? formatUsd(order.tax) : '—'}</Row>
          <Row label={t('shipping')}>{order.shipping != null ? formatUsd(order.shipping) : '—'}</Row>
          <Row label={t('grandTotal')} strong>
            {formatUsd(lineSum + (order.tax ?? 0) + (order.shipping ?? 0))}
          </Row>
        </dl>
      </CardContent>
    </Card>
  )
}

function Row({
  label,
  strong,
  children,
}: {
  label: string
  strong?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'border-t pt-1 font-medium' : ''}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  )
}
