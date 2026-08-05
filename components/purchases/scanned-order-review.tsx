'use client'

import { AlertTriangle, X } from 'lucide-react'
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
import type { ParsedOrder } from '@/lib/imports/amazon-order'

interface Props {
  order: ParsedOrder
  warnings: string[]
  onDismiss: () => void
}

/**
 * What was read off the screenshot, before anything is saved — line by line and
 * against the totals Amazon printed, so it can be checked against the original
 * at a glance. The form below stays the place to correct anything.
 */
export function ScannedOrderReview({ order, warnings, onDismiss }: Props) {
  const lineSum = order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  const subtotalMismatch =
    order.itemsSubtotal != null && Math.abs(lineSum - order.itemsSubtotal) > 0.02

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Read from the screenshot</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {[
              order.orderNumber ? `Order ${order.orderNumber}` : 'No order number found',
              order.purchasedAt ? formatDate(order.purchasedAt) : 'no date found',
              `${order.items.length} item${order.items.length === 1 ? '' : 's'}`,
            ].join(' · ')}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <X className="size-4" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {warnings.length > 0 && (
          <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">Check this against the screenshot</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Line total</TableHead>
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
                        Sold by {item.seller}
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
          <Row label="Items">
            <span className={subtotalMismatch ? 'text-amber-600' : undefined}>
              {formatUsd(lineSum)}
            </span>
            {subtotalMismatch && (
              <span className="text-xs text-muted-foreground">
                {' '}
                (screenshot: {formatUsd(order.itemsSubtotal!)})
              </span>
            )}
          </Row>
          <Row label="Tax">{order.tax != null ? formatUsd(order.tax) : '—'}</Row>
          <Row label="Shipping">{order.shipping != null ? formatUsd(order.shipping) : '—'}</Row>
          <Row label="Grand total" strong>
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
