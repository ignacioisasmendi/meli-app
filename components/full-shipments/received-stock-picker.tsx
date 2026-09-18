'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ProductThumb } from '@/components/products/product-thumb'
import type { ReceivedProduct } from '@/lib/inventory/full-shipments'

/** Product → units going, as typed. A missing or empty entry means none. */
export type FullQuantities = Record<string, string>

export function toFullLines(quantities: FullQuantities) {
  return Object.entries(quantities)
    .map(([productId, qty]) => ({ productId, quantity: Number(qty) }))
    .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0)
}

/** True when every typed quantity is a whole number within what was received. */
export function fullQuantitiesValid(products: ReceivedProduct[], quantities: FullQuantities) {
  return Object.entries(quantities).every(([productId, qty]) => {
    if (qty === '') return true
    const n = Number(qty)
    const max = products.find((p) => p.productId === productId)?.quantity ?? 0
    return Number.isInteger(n) && n >= 0 && n <= max
  })
}

/**
 * Received stock, one row per product, with how many units of each go into the
 * Full box. "Send all" fills every row with everything received.
 */
export function ReceivedStockPicker({
  products,
  quantities,
  onChange,
}: {
  products: ReceivedProduct[] | null
  quantities: FullQuantities
  onChange: (next: FullQuantities) => void
}) {
  const t = useTranslations('ReceivedStockPicker')

  const lines = toFullLines(quantities)
  const units = lines.reduce((n, l) => n + l.quantity, 0)
  const allSelected =
    products !== null &&
    products.length > 0 &&
    products.every((p) => Number(quantities[p.productId]) === p.quantity)

  function sendAll() {
    if (!products) return
    onChange(Object.fromEntries(products.map((p) => [p.productId, String(p.quantity)])))
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t('selected', { units, count: lines.length })}
        </p>
        <div className="flex gap-1">
          {lines.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>
              {t('clear')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={sendAll}
            disabled={!products?.length || allSelected}
          >
            {t('sendAll')}
          </Button>
        </div>
      </div>

      <ScrollArea className="max-h-72 rounded-md border">
        {products === null && (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('loading')}</p>
        )}
        {products?.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('nothingReceived')}</p>
        )}
        {products && products.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('product')}</TableHead>
                <TableHead className="text-right">{t('received')}</TableHead>
                <TableHead className="w-36">{t('going')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => {
                const qty = quantities[p.productId] ?? ''
                const n = Number(qty)
                const over = qty !== '' && (!Number.isInteger(n) || n < 0 || n > p.quantity)
                return (
                  <TableRow key={p.productId} data-state={n > 0 ? 'selected' : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ProductThumb src={p.imageUrl} alt="" />
                        <span className="min-w-0">
                          <span className="block max-w-56 truncate text-sm font-medium">
                            {p.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">{p.sku}</span>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{p.quantity}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          max={p.quantity}
                          value={qty}
                          placeholder="0"
                          aria-invalid={over}
                          aria-label={t('goingFor', { name: p.name })}
                          className="h-8 w-16"
                          onChange={(e) => onChange({ ...quantities, [p.productId]: e.target.value })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          disabled={n === p.quantity}
                          onClick={() =>
                            onChange({ ...quantities, [p.productId]: String(p.quantity) })
                          }
                        >
                          {t('all')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </ScrollArea>
    </div>
  )
}
