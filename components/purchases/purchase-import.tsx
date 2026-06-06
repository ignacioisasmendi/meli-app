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
import { formatUsd } from '@/lib/utils'
import { allocateLandedCosts } from '@/lib/inventory/landed'
import { importPurchases, type ImportPayload } from '@/actions/imports'

interface ProductOption {
  id: string
  name: string
  sku: string
}

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

export function PurchaseImport({ products }: { products: ProductOption[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [orderNumber, setOrderNumber] = useState('')
  const [supplier, setSupplier] = useState('Amazon')
  const [purchasedAt, setPurchasedAt] = useState('')
  const [tax, setTax] = useState('')
  const [shipping, setShipping] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()])

  function patch(i: number, change: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...change } : l)))
  }

  // Live preview of per-unit landed cost (tax + shipping allocated by value).
  const landed = allocateLandedCosts(
    lines.map((l) => ({ quantity: num(l.quantity), unitPrice: num(l.unitPrice) })),
    { tax: num(tax), shipping: num(shipping) }
  )
  const grandTotal = lines.reduce((sum, l, i) => sum + num(l.quantity) * landed[i], 0)

  function onImport() {
    const payload: ImportPayload = {
      orderNumber: orderNumber.trim(),
      supplier: supplier.trim(),
      purchasedAt: purchasedAt || undefined,
      tax: num(tax),
      shipping: num(shipping),
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
        router.push('/purchases')
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="space-y-6">
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
                      → {formatUsd(landed[i])}/unit landed
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
                          {p.name} ({p.sku})
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
              Total landed cost:{' '}
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
