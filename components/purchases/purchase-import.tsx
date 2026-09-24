'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PasteOrderImport } from '@/components/purchases/paste-order-import'
import { NEW_PRODUCT, ProductPicker } from '@/components/purchases/product-picker'
import { ScannedOrderReview } from '@/components/purchases/scanned-order-review'
import { ScreenshotDropzone } from '@/components/purchases/screenshot-dropzone'
import { formatUsd } from '@/lib/utils'
import { allocateOrder } from '@/lib/inventory/landed'
import { matchProduct, suggestSku } from '@/lib/imports/match-product'
import type { OrderWarning, ParsedOrder } from '@/lib/imports/amazon-order'
import { importPurchases, type ImportPayload } from '@/actions/imports'

interface ProductOption {
  id: string
  name: string
  sku: string
}

export interface ShipmentOption {
  id: string
  code: string
  courier: string | null
}

const NO_SHIPMENT = '__none__'

interface DraftLine {
  mode: 'existing' | 'new'
  productId: string
  sku: string
  name: string
  quantity: string
  unitPrice: string
  /** The item's Amazon ASIN, when the order came with one — imported as an alias. */
  asin?: string
  /** How the product was picked: a known ASIN is certain, a name match is a guess. */
  matchedBy?: 'asin' | 'name'
}

const emptyLine = (): DraftLine => ({
  mode: 'new',
  productId: '',
  sku: '',
  name: '',
  quantity: '1',
  unitPrice: '',
})

/**
 * Draft lines for a scanned order. An item whose ASIN was imported before maps
 * onto that product; otherwise one that clearly matches an existing product by
 * name is mapped onto it; the rest become new products with a suggested SKU.
 */
function linesFromOrder(
  order: ParsedOrder,
  products: ProductOption[],
  knownAsins: Record<string, string> = {}
): DraftLine[] {
  const taken = new Set(products.map((p) => p.sku.toUpperCase()))
  return order.items.map((item): DraftLine => {
    const common = {
      quantity: String(item.quantity),
      unitPrice: String(item.unitPrice),
      asin: item.asin ?? undefined,
    }
    const byAsin = item.asin ? products.find((p) => p.id === knownAsins[item.asin!]) : undefined
    const match = byAsin ?? matchProduct(item.fullTitle || item.name, products)
    if (match) {
      return {
        ...common,
        mode: 'existing',
        productId: match.id,
        sku: '',
        name: match.name,
        matchedBy: byAsin ? 'asin' : 'name',
      }
    }
    const sku = suggestSku(item.name, taken)
    taken.add(sku)
    return { ...common, mode: 'new', productId: '', sku, name: item.name }
  })
}

/** An order captured by the browser extension, already read and waiting for review. */
export interface ImportDraftInput {
  id: string
  order: ParsedOrder
  warnings: OrderWarning[]
  /** ASIN → product id, for the draft's ASINs already imported before. */
  knownAsins: Record<string, string>
}

const num = (s: string) => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

export function PurchaseImport({
  products,
  shipments,
  canUploadScreenshot,
  draft,
}: {
  products: ProductOption[]
  /** Shipments still open to receive purchases. */
  shipments: ShipmentOption[]
  /** The API import path only works when ANTHROPIC_API_KEY is configured. */
  canUploadScreenshot: boolean
  /** Pre-fills the form; importing marks the draft done. Remount (key) to switch drafts. */
  draft?: ImportDraftInput
}) {
  const t = useTranslations('PurchaseImport')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const initial = draft?.order
  const [orderNumber, setOrderNumber] = useState(initial?.orderNumber ?? '')
  const [supplier, setSupplier] = useState('Amazon')
  const [purchasedAt, setPurchasedAt] = useState(initial?.purchasedAt ?? '')
  const [arrivedAt, setArrivedAt] = useState('')
  const [estimatedArrivalAt, setEstimatedArrivalAt] = useState('')
  const [tax, setTax] = useState(initial?.tax != null ? String(initial.tax) : '')
  const [shipping, setShipping] = useState(initial?.shipping != null ? String(initial.shipping) : '')
  const [shipmentId, setShipmentId] = useState(NO_SHIPMENT)
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initial && initial.items.length > 0
      ? linesFromOrder(initial, products, draft.knownAsins)
      : [emptyLine()]
  )
  const [scanned, setScanned] = useState<{ order: ParsedOrder; warnings: OrderWarning[] } | null>(
    draft ? { order: draft.order, warnings: draft.warnings } : null
  )
  // Filling the form from a screenshot replaces whatever the draft had put there.
  const [draftId, setDraftId] = useState(draft?.id)

  function patch(i: number, change: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...change } : l)))
  }

  /**
   * Fills the form from a scanned order (see `linesFromOrder`). Everything
   * stays editable — nothing is saved until "Import".
   */
  function applyParsed(order: ParsedOrder, orderWarnings: OrderWarning[]) {
    if (order.items.length === 0) {
      toast.error(t('noItemsFound'))
      return
    }

    setSupplier('Amazon')
    setOrderNumber(order.orderNumber ?? '')
    setPurchasedAt(order.purchasedAt ?? '')
    setTax(order.tax != null ? String(order.tax) : '')
    setShipping(order.shipping != null ? String(order.shipping) : '')
    setScanned({ order, warnings: orderWarnings })
    setDraftId(undefined)

    const scannedLines = linesFromOrder(order, products)
    setLines(scannedLines)
    const matched = scannedLines.filter((l) => l.mode === 'existing').length
    toast.success(
      t('readItems', { count: scannedLines.length }) +
        (matched > 0 ? ` — ${t('matchedExisting', { count: matched })}` : '')
    )
  }

  // Live preview of the same breakdown that gets recorded on each purchase:
  // goods, then this line's share of the order's tax and shipping.
  const allocated = allocateOrder(
    lines.map((l) => ({ quantity: num(l.quantity), unitPrice: num(l.unitPrice) })),
    { tax: num(tax), shipping: num(shipping) }
  )
  const grandTotal = allocated.reduce((sum, a) => sum + a.totalUsd, 0)

  function onImport() {
    const payload: ImportPayload = {
      orderNumber: orderNumber.trim(),
      supplier: supplier.trim(),
      purchasedAt: purchasedAt || undefined,
      arrivedAt: arrivedAt || undefined,
      estimatedArrivalAt: estimatedArrivalAt || undefined,
      tax: num(tax),
      shipping: num(shipping),
      shipmentId: shipmentId === NO_SHIPMENT ? undefined : shipmentId,
      draftId,
      lines: lines.map((l) => ({
        mode: l.mode,
        productId: l.mode === 'existing' ? l.productId : undefined,
        sku: l.mode === 'new' ? l.sku.trim() : undefined,
        name: l.name.trim(),
        quantity: num(l.quantity),
        unitPrice: num(l.unitPrice),
        asin: l.asin,
      })),
    }
    startTransition(async () => {
      const res = await importPurchases(payload)
      if (res.ok) {
        toast.success(t('purchasesImported'))
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
          <CardTitle>{t('fillFromScreenshot')}</CardTitle>
        </CardHeader>
        <CardContent>
          {canUploadScreenshot ? (
            <Tabs defaultValue="paste">
              <TabsList className="mb-4">
                <TabsTrigger value="paste">{t('pasteFromClaude')}</TabsTrigger>
                <TabsTrigger value="upload">{t('uploadScreenshot')}</TabsTrigger>
              </TabsList>
              <TabsContent value="paste">
                <PasteOrderImport onParsed={applyParsed} disabled={pending} />
              </TabsContent>
              <TabsContent value="upload">
                <ScreenshotDropzone onParsed={applyParsed} disabled={pending} />
              </TabsContent>
            </Tabs>
          ) : (
            <PasteOrderImport onParsed={applyParsed} disabled={pending} />
          )}
        </CardContent>
      </Card>

      {scanned && (
        <ScannedOrderReview
          order={scanned.order}
          warnings={scanned.warnings}
          onDismiss={() => setScanned(null)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('orderDetails')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-2">
            <Label htmlFor="supplier">{t('supplier')}</Label>
            <Input id="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="orderNumber">{t('orderNumber')}</Label>
            <Input
              id="orderNumber"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="123-4567890-1234567"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="purchasedAt">{t('purchaseDate')}</Label>
            <Input
              id="purchasedAt"
              type="date"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="arrivedAt">{t('arrivalDate')}</Label>
            <Input
              id="arrivedAt"
              type="date"
              value={arrivedAt}
              onChange={(e) => setArrivedAt(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="estimatedArrivalAt">{t('estimatedArrival')}</Label>
            <Input
              id="estimatedArrivalAt"
              type="date"
              value={estimatedArrivalAt}
              onChange={(e) => setEstimatedArrivalAt(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label htmlFor="tax">{t('taxUsd')}</Label>
              <Input
                id="tax"
                type="number"
                step="0.01"
                min={0}
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="shipping">{t('shippingUsd')}</Label>
              <Input
                id="shipping"
                type="number"
                step="0.01"
                min={0}
                value={shipping}
                onChange={(e) => setShipping(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="grid gap-2 sm:col-span-2 lg:col-span-4">
            <Label htmlFor="shipment">{t('shipment')}</Label>
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
            <p className="text-xs text-muted-foreground">{t('taxShippingHint')}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('items')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {lines.map((line, i) => (
            <div key={i} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  {t('itemNumber', { n: i + 1 })}
                  {num(line.unitPrice) > 0 && (
                    <span className="ml-2 text-foreground">
                      {formatUsd(allocated[i].goodsUsd)}
                      {allocated[i].taxUsd > 0 && (
                        <span className="text-muted-foreground">
                          {' '}
                          + {t('plusTax', { value: formatUsd(allocated[i].taxUsd) })}
                          {' '}
                          ({t('perUnitWithTax', { value: formatUsd(allocated[i].unitPriceWithTaxUsd) })})
                        </span>
                      )}
                      {allocated[i].shippingUsd > 0 && (
                        <span className="text-muted-foreground">
                          {' '}
                          + {t('plusShipping', { value: formatUsd(allocated[i].shippingUsd) })}
                        </span>
                      )}
                      {' = '}
                      {formatUsd(allocated[i].totalUsd)}
                      <span className="text-muted-foreground">
                        {' '}
                        ({t('perUnit', { value: formatUsd(allocated[i].unitCostUsd) })})
                      </span>
                    </span>
                  )}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  disabled={lines.length === 1}
                  onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label className="flex flex-wrap items-center gap-2">
                    {t('mapTo')}
                    {line.asin && (
                      <span className="font-mono text-xs font-normal text-muted-foreground">
                        ASIN {line.asin}
                      </span>
                    )}
                    {line.matchedBy === 'asin' && (
                      <Badge variant="secondary" className="font-normal">
                        {t('matchedByAsin')}
                      </Badge>
                    )}
                  </Label>
                  <ProductPicker
                    products={products}
                    value={line.mode === 'existing' ? line.productId : NEW_PRODUCT}
                    onChange={(v) =>
                      v === NEW_PRODUCT
                        ? patch(i, { mode: 'new', matchedBy: undefined })
                        : patch(i, {
                            mode: 'existing',
                            productId: v,
                            name: products.find((p) => p.id === v)?.name ?? line.name,
                            matchedBy: undefined,
                          })
                    }
                  />
                </div>

                {line.mode === 'new' && (
                  <div className="grid gap-2">
                    <Label>{t('newSku')}</Label>
                    <Input
                      value={line.sku}
                      onChange={(e) => patch(i, { sku: e.target.value })}
                      placeholder={t('uniqueSku')}
                    />
                  </div>
                )}

                <div className="grid gap-2 md:col-span-2">
                  <Label>{t('productName')}</Label>
                  <Input
                    value={line.name}
                    onChange={(e) => patch(i, { name: e.target.value })}
                    placeholder={t('productNamePlaceholder')}
                    disabled={line.mode === 'existing'}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>{t('quantity')}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(e) => patch(i, { quantity: e.target.value })}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>{t('unitPriceBeforeTax')}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={line.unitPrice}
                    onChange={(e) => patch(i, { unitPrice: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" onClick={() => setLines([...lines, emptyLine()])}>
            <Plus className="size-4" />
            {t('addItem')}
          </Button>

          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">
              {t('orderTotalLabel')}{' '}
              <span className="font-medium text-foreground">{formatUsd(grandTotal)}</span>
            </span>
            <Button onClick={onImport} disabled={pending}>
              {pending ? t('importing') : t('importPurchases', { count: lines.length })}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
