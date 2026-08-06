'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { ScannedOrderReview } from '@/components/purchases/scanned-order-review'
import { ScreenshotDropzone } from '@/components/purchases/screenshot-dropzone'
import { formatUsd } from '@/lib/utils'
import { allocateOrder } from '@/lib/inventory/landed'
import { matchProduct, suggestSku } from '@/lib/imports/match-product'
import type { ParsedOrder } from '@/lib/imports/amazon-order'
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
}

const emptyLine = (): DraftLine => ({
  mode: 'new',
  productId: '',
  sku: '',
  name: '',
  quantity: '1',
  unitPrice: '',
})

const num = (s: string) => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

export function PurchaseImport({
  products,
  shipments,
  canUploadScreenshot,
}: {
  products: ProductOption[]
  /** Shipments still open to receive purchases. */
  shipments: ShipmentOption[]
  /** The API import path only works when ANTHROPIC_API_KEY is configured. */
  canUploadScreenshot: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [orderNumber, setOrderNumber] = useState('')
  const [supplier, setSupplier] = useState('Amazon')
  const [purchasedAt, setPurchasedAt] = useState('')
  const [tax, setTax] = useState('')
  const [shipping, setShipping] = useState('')
  const [shipmentId, setShipmentId] = useState(NO_SHIPMENT)
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()])
  const [scanned, setScanned] = useState<{ order: ParsedOrder; warnings: string[] } | null>(null)

  function patch(i: number, change: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...change } : l)))
  }

  /**
   * Fills the form from a scanned order. Items that clearly match an existing
   * product are mapped onto it; the rest become new products with a suggested
   * SKU. Everything stays editable — nothing is saved until "Import".
   */
  function applyParsed(order: ParsedOrder, orderWarnings: string[]) {
    if (order.items.length === 0) {
      toast.error('No items were found in that order')
      return
    }

    setSupplier('Amazon')
    setOrderNumber(order.orderNumber ?? '')
    setPurchasedAt(order.purchasedAt ?? '')
    setTax(order.tax != null ? String(order.tax) : '')
    setShipping(order.shipping != null ? String(order.shipping) : '')
    setScanned({ order, warnings: orderWarnings })

    const taken = new Set(products.map((p) => p.sku.toUpperCase()))
    const scannedLines = order.items.map((item): DraftLine => {
      const match = matchProduct(item.fullTitle || item.name, products)
      if (match) {
        return {
          mode: 'existing',
          productId: match.id,
          sku: '',
          name: match.name,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
        }
      }
      const sku = suggestSku(item.name, taken)
      taken.add(sku)
      return {
        mode: 'new',
        productId: '',
        sku,
        name: item.name,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
      }
    })

    setLines(scannedLines)
    const matched = scannedLines.filter((l) => l.mode === 'existing').length
    toast.success(
      `Read ${scannedLines.length} item${scannedLines.length === 1 ? '' : 's'}` +
        (matched > 0 ? ` — ${matched} matched to existing products` : '')
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
      tax: num(tax),
      shipping: num(shipping),
      shipmentId: shipmentId === NO_SHIPMENT ? undefined : shipmentId,
      lines: lines.map((l) => ({
        mode: l.mode,
        productId: l.mode === 'existing' ? l.productId : undefined,
        sku: l.mode === 'new' ? l.sku.trim() : undefined,
        name: l.name.trim(),
        quantity: num(l.quantity),
        unitPrice: num(l.unitPrice),
      })),
    }
    startTransition(async () => {
      const res = await importPurchases(payload)
      if (res.ok) {
        toast.success('Purchases imported')
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
          <CardTitle>Fill from an Amazon screenshot</CardTitle>
        </CardHeader>
        <CardContent>
          {canUploadScreenshot ? (
            <Tabs defaultValue="paste">
              <TabsList className="mb-4">
                <TabsTrigger value="paste">Paste from Claude</TabsTrigger>
                <TabsTrigger value="upload">Upload screenshot</TabsTrigger>
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
          <CardTitle>Order details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-2">
            <Label htmlFor="supplier">Supplier</Label>
            <Input id="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="orderNumber">Order number</Label>
            <Input
              id="orderNumber"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="123-4567890-1234567"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="purchasedAt">Purchase date</Label>
            <Input
              id="purchasedAt"
              type="date"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label htmlFor="tax">Tax (USD)</Label>
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
              <Label htmlFor="shipping">Shipping (USD)</Label>
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
            <Label htmlFor="shipment">Shipment</Label>
            <Select value={shipmentId} onValueChange={setShipmentId}>
              <SelectTrigger id="shipment" className="lg:w-1/2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SHIPMENT}>Not in a shipment yet</SelectItem>
                {shipments.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.code}
                    {s.courier ? ` · ${s.courier}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The tax and shipping above are Amazon’s. Import freight is added later, when
              the box lands and you enter the courier bill on the shipment.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {lines.map((line, i) => (
            <div key={i} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Item {i + 1}
                  {num(line.unitPrice) > 0 && (
                    <span className="ml-2 text-foreground">
                      {formatUsd(allocated[i].goodsUsd)}
                      {allocated[i].taxUsd > 0 && (
                        <span className="text-muted-foreground">
                          {' '}
                          + {formatUsd(allocated[i].taxUsd)} tax
                        </span>
                      )}
                      {allocated[i].shippingUsd > 0 && (
                        <span className="text-muted-foreground">
                          {' '}
                          + {formatUsd(allocated[i].shippingUsd)} shipping
                        </span>
                      )}
                      {' = '}
                      {formatUsd(allocated[i].totalUsd)}
                      <span className="text-muted-foreground">
                        {' '}
                        ({formatUsd(allocated[i].unitCostUsd)}/unit)
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
                  <Label>Map to</Label>
                  <Select
                    value={line.mode === 'existing' ? line.productId : '__new__'}
                    onValueChange={(v) =>
                      v === '__new__'
                        ? patch(i, { mode: 'new' })
                        : patch(i, {
                            mode: 'existing',
                            productId: v,
                            name: products.find((p) => p.id === v)?.name ?? line.name,
                          })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new__">+ Create new product</SelectItem>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {line.mode === 'new' && (
                  <div className="grid gap-2">
                    <Label>New SKU</Label>
                    <Input
                      value={line.sku}
                      onChange={(e) => patch(i, { sku: e.target.value })}
                      placeholder="Unique SKU"
                    />
                  </div>
                )}

                <div className="grid gap-2 md:col-span-2">
                  <Label>Product name</Label>
                  <Input
                    value={line.name}
                    onChange={(e) => patch(i, { name: e.target.value })}
                    placeholder="e.g. DJI Mic Mini (1 TX + 1 RX)"
                    disabled={line.mode === 'existing'}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(e) => patch(i, { quantity: e.target.value })}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Unit price (USD, before tax)</Label>
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
            Add item
          </Button>

          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">
              Order total (goods + tax + shipping):{' '}
              <span className="font-medium text-foreground">{formatUsd(grandTotal)}</span>
            </span>
            <Button onClick={onImport} disabled={pending}>
              {pending
                ? 'Importing…'
                : `Import ${lines.length} purchase${lines.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
