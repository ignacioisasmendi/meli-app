'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, ClipboardPaste, Copy, FileUp, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { formatUsd } from '@/lib/utils'
import { allocateOrder } from '@/lib/inventory/landed'
import { matchProduct, suggestSku } from '@/lib/imports/match-product'
import {
  BULK_EXAMPLE,
  parseBulkOrders,
  type BulkOrder,
  type BulkWarning,
} from '@/lib/imports/bulk-orders'
import { importPurchasesBulk, type BulkImportPayload } from '@/actions/imports'
import type { ShipmentOption } from '@/components/purchases/purchase-import'

interface ProductOption {
  id: string
  name: string
  sku: string
}

const NO_SHIPMENT = '__none__'
const NEW_PRODUCT = '__new__'

interface DraftLine {
  mode: 'existing' | 'new'
  productId: string
  sku: string
  name: string
  quantity: number
  unitPrice: number
  /** List price before the order discount, shown for reference only. */
  listPrice: number
}

interface DraftOrder extends Omit<BulkOrder, 'items'> {
  lines: DraftLine[]
}

const orderKey = (supplier: string, orderNumber: string | null) =>
  orderNumber ? `${supplier.trim().toLowerCase()}|${orderNumber.trim()}` : null

const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Maps every item onto the catalog: an explicit SKU wins, then a confident name
 * match, otherwise a new product. The same new item appearing in several orders
 * gets ONE suggested SKU, so the import creates one product and restocks it
 * rather than a near-duplicate per order.
 */
function toDrafts(orders: BulkOrder[], products: ProductOption[]): DraftOrder[] {
  const bySku = new Map(products.map((p) => [p.sku.toUpperCase(), p]))
  const taken = new Set(bySku.keys())
  const newSkuByName = new Map<string, string>()

  return orders.map(({ items, ...order }) => ({
    ...order,
    lines: items.map((item): DraftLine => {
      const base = {
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        listPrice: item.listPrice,
      }
      const explicit = item.sku ? bySku.get(item.sku.toUpperCase()) : undefined
      const match = explicit ?? (item.sku ? null : matchProduct(item.name, products))
      if (match) {
        return { ...base, mode: 'existing', productId: match.id, sku: '', name: match.name }
      }

      let sku = item.sku ?? newSkuByName.get(normalizeName(item.name))
      if (!sku) {
        sku = suggestSku(item.name, taken)
        taken.add(sku)
        newSkuByName.set(normalizeName(item.name), sku)
      }
      return { ...base, mode: 'new', productId: '', sku }
    }),
  }))
}

export function BulkOrderImport({
  products,
  shipments,
  existingOrderKeys,
}: {
  products: ProductOption[]
  shipments: ShipmentOption[]
  /** `supplier|orderNumber` (supplier lower-cased) of every order already imported. */
  existingOrderKeys: string[]
}) {
  const t = useTranslations('BulkOrderImport')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const fileInput = useRef<HTMLInputElement>(null)

  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [shipmentId, setShipmentId] = useState(NO_SHIPMENT)
  const [drafts, setDrafts] = useState<DraftOrder[] | null>(null)

  const existing = new Set(existingOrderKeys)

  function describeWarning(w: BulkWarning): string {
    switch (w.code) {
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

  function read(source = text) {
    const result = parseBulkOrders(source)
    if (!result.ok) {
      setError(result.error)
      setDrafts(null)
      return
    }
    setError(null)
    const next = toDrafts(result.orders, products)
    setDrafts(next)
    toast.success(t('readOrders', { count: next.length }))
  }

  async function loadFile(file: File) {
    const content = await file.text()
    setText(content)
    read(content)
  }

  async function copyExample() {
    try {
      await navigator.clipboard.writeText(BULK_EXAMPLE)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setText(BULK_EXAMPLE)
    }
  }

  function patchLine(o: number, l: number, change: Partial<DraftLine>) {
    setDrafts((prev) =>
      prev!.map((order, oi) =>
        oi === o
          ? { ...order, lines: order.lines.map((line, li) => (li === l ? { ...line, ...change } : line)) }
          : order
      )
    )
  }

  function removeOrder(o: number) {
    setDrafts((prev) => {
      const next = prev!.filter((_, oi) => oi !== o)
      return next.length ? next : null
    })
  }

  const duplicates = new Set(
    (drafts ?? [])
      .map((d, i) => (existing.has(orderKey(d.supplier, d.orderNumber) ?? '') ? i : -1))
      .filter((i) => i >= 0)
  )

  const totals = (drafts ?? []).reduce(
    (acc, d) => {
      const allocated = allocateOrder(d.lines, { tax: d.tax, shipping: d.shipping })
      acc.usd += allocated.reduce((s, a) => s + a.totalUsd, 0)
      acc.lines += d.lines.length
      acc.units += d.lines.reduce((s, l) => s + l.quantity, 0)
      for (const l of d.lines) if (l.mode === 'new') acc.newSkus.add(l.sku.trim().toUpperCase())
      return acc
    },
    { usd: 0, lines: 0, units: 0, newSkus: new Set<string>() }
  )

  function onImport() {
    if (!drafts) return
    const payload: BulkImportPayload = drafts.map((d) => ({
      orderNumber: d.orderNumber ?? '',
      supplier: d.supplier,
      purchasedAt: d.purchasedAt ?? undefined,
      arrivedAt: d.arrivedAt ?? undefined,
      estimatedArrivalAt: d.estimatedArrivalAt ?? undefined,
      tax: d.tax,
      shipping: d.shipping,
      shipmentId: shipmentId === NO_SHIPMENT ? undefined : shipmentId,
      lines: d.lines.map((l) => ({
        mode: l.mode,
        productId: l.mode === 'existing' ? l.productId : undefined,
        sku: l.mode === 'new' ? l.sku.trim() : undefined,
        name: l.name.trim(),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
    }))
    startTransition(async () => {
      const res = await importPurchasesBulk(payload)
      if (res.ok) {
        toast.success(t('imported', { count: payload.length }))
        router.push(shipmentId === NO_SHIPMENT ? '/purchases' : `/shipments/${shipmentId}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('pasteTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('formatHint')}</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{BULK_EXAMPLE}</pre>
          <p className="text-xs text-muted-foreground">{t('fieldsHint')}</p>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copyExample}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? t('copied') : t('copyExample')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
            >
              <FileUp className="size-4" />
              {t('loadFile')}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) loadFile(file)
                e.target.value = ''
              }}
            />
          </div>

          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            rows={10}
            spellCheck={false}
            placeholder={t('placeholder')}
            className="font-mono text-xs"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="button" onClick={() => read()} disabled={pending || !text.trim()}>
            <ClipboardPaste className="size-4" />
            {t('read')}
          </Button>
        </CardContent>
      </Card>

      {drafts && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('shipment')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Label htmlFor="shipment" className="sr-only">
                {t('shipment')}
              </Label>
              <Select value={shipmentId} onValueChange={setShipmentId}>
                <SelectTrigger id="shipment" className="lg:w-1/2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SHIPMENT}>{t('notInShipmentYet')}</SelectItem>
                  {shipments.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code}
                      {s.courier ? ` · ${s.courier}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('shipmentHint')}</p>
            </CardContent>
          </Card>

          {drafts.map((order, o) => {
            const allocated = allocateOrder(order.lines, { tax: order.tax, shipping: order.shipping })
            const total = allocated.reduce((s, a) => s + a.totalUsd, 0)
            return (
              <Card key={o} className={duplicates.has(o) ? 'border-destructive' : undefined}>
                <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                  <div className="space-y-1">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {t('orderN', { n: o + 1 })}
                      {order.orderNumber && (
                        <span className="font-mono text-sm font-normal">{order.orderNumber}</span>
                      )}
                      <Badge variant="outline">{order.supplier}</Badge>
                      {duplicates.has(o) && (
                        <Badge variant="destructive">
                          <AlertTriangle className="size-3" />
                          {t('alreadyImported')}
                        </Badge>
                      )}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {order.purchasedAt ?? t('today')}
                      {order.arrivedAt && ` · ${t('arrived', { date: order.arrivedAt })}`}
                      {!order.arrivedAt &&
                        order.estimatedArrivalAt &&
                        ` · ${t('estimated', { date: order.estimatedArrivalAt })}`}
                      {order.discount > 0 &&
                        ` · ${t('discount', { value: formatUsd(order.discount) })}`}
                      {' · '}
                      {t('taxShipping', {
                        tax: formatUsd(order.tax),
                        shipping: formatUsd(order.shipping),
                      })}
                      {' · '}
                      <span className="font-medium text-foreground">{formatUsd(total)}</span>
                    </p>
                    {order.warnings.map((w) => (
                      <p
                        key={w.code}
                        className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500"
                      >
                        <AlertTriangle className="size-3 shrink-0" />
                        {describeWarning(w)}
                      </p>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    title={t('removeOrder')}
                    onClick={() => removeOrder(o)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('item')}</TableHead>
                        <TableHead className="min-w-64">{t('mapTo')}</TableHead>
                        <TableHead className="text-right">{t('qty')}</TableHead>
                        <TableHead className="text-right">{t('unitPrice')}</TableHead>
                        <TableHead className="text-right">{t('unitCost')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {order.lines.map((line, l) => (
                        <TableRow key={l}>
                          <TableCell className="max-w-72 truncate" title={line.name}>
                            {line.name}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Select
                                value={line.mode === 'existing' ? line.productId : NEW_PRODUCT}
                                onValueChange={(v) =>
                                  v === NEW_PRODUCT
                                    ? patchLine(o, l, {
                                        mode: 'new',
                                        sku: line.sku || suggestSku(line.name, new Set(products.map((p) => p.sku.toUpperCase()))),
                                      })
                                    : patchLine(o, l, { mode: 'existing', productId: v })
                                }
                              >
                                <SelectTrigger className="h-8 w-48">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NEW_PRODUCT}>{t('newProduct')}</SelectItem>
                                  {products.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                      {p.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {line.mode === 'new' && (
                                <Input
                                  className="h-8 w-40 font-mono text-xs"
                                  value={line.sku}
                                  placeholder="SKU"
                                  onChange={(e) => patchLine(o, l, { sku: e.target.value })}
                                />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{line.quantity}</TableCell>
                          <TableCell className="text-right">
                            {formatUsd(line.unitPrice)}
                            {line.listPrice !== line.unitPrice && (
                              <span className="block text-xs text-muted-foreground line-through">
                                {formatUsd(line.listPrice)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatUsd(allocated[l].unitCostUsd)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )
          })}

          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
              <span className="text-sm text-muted-foreground">
                {t('summary', {
                  orders: drafts.length,
                  lines: totals.lines,
                  units: totals.units,
                  newProducts: totals.newSkus.size,
                })}{' '}
                <span className="font-medium text-foreground">{formatUsd(totals.usd)}</span>
              </span>
              <div className="flex items-center gap-3">
                {duplicates.size > 0 && (
                  <span className="text-sm text-destructive">{t('removeDuplicates')}</span>
                )}
                <Button onClick={onImport} disabled={pending || duplicates.size > 0}>
                  {pending ? t('importing') : t('importOrders', { count: drafts.length })}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
