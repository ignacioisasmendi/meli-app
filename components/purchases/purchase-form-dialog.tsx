'use client'

import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PURCHASE_STATUS_VALUES } from '@/lib/statuses'
import { formatUsd } from '@/lib/utils'
import { registerPurchase } from '@/actions/purchases'

interface ProductOption {
  id: string
  name: string
  sku: string
}

export function PurchaseFormDialog({ products }: { products: ProductOption[] }) {
  const t = useTranslations('PurchaseForm')
  const tStatus = useTranslations('Status')
  const tCommon = useTranslations('Common')
  const [open, setOpen] = useState(false)
  const [productId, setProductId] = useState('')
  const [status, setStatus] = useState('PURCHASED')
  const [costMode, setCostMode] = useState<'unit' | 'total'>('unit')
  const [quantity, setQuantity] = useState('')
  const [cost, setCost] = useState('')
  const [isPending, startTransition] = useTransition()

  const qty = Number(quantity)
  const amount = Number(cost)
  const derived =
    qty > 0 && amount > 0 ? (costMode === 'unit' ? qty * amount : amount / qty) : null

  function onSubmit(formData: FormData) {
    formData.set('productId', productId)
    formData.set('status', status)
    formData.set('costMode', costMode)
    startTransition(async () => {
      const result = await registerPurchase(formData)
      if (result.ok) {
        toast.success(t('purchaseRegistered'))
        setOpen(false)
        setProductId('')
        setQuantity('')
        setCost('')
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={products.length === 0}>
          <Plus className="size-4" />
          {t('registerPurchase')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>{t('registerPurchase')}</DialogTitle>
            <DialogDescription>{t('createsInventoryBatch')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t('product')}</Label>
              <Select value={productId} onValueChange={setProductId} required>
                <SelectTrigger>
                  <SelectValue placeholder={t('selectProduct')} />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Tabs value={costMode} onValueChange={(v) => setCostMode(v as 'unit' | 'total')}>
                <TabsList>
                  <TabsTrigger value="unit">{t('costModeUnit')}</TabsTrigger>
                  <TabsTrigger value="total">{t('costModeTotal')}</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="quantity">{t('quantity')}</Label>
                  <Input
                    id="quantity"
                    name="quantity"
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="cost">
                    {costMode === 'unit' ? t('unitCostUsd') : t('totalCostUsd')}
                  </Label>
                  <Input
                    id="cost"
                    name="cost"
                    type="number"
                    step="0.01"
                    min={0}
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    required
                  />
                </div>
              </div>
              {derived !== null && (
                <p className="text-xs text-muted-foreground">
                  {costMode === 'unit'
                    ? t('derivedTotal', { value: formatUsd(derived) })
                    : t('derivedUnit', { value: formatUsd(derived) })}
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="supplier">{t('supplier')}</Label>
              <Input id="supplier" name="supplier" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>{t('status')}</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PURCHASE_STATUS_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {tStatus(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="purchasedAt">{t('purchasedAt')}</Label>
                <Input id="purchasedAt" name="purchasedAt" type="date" />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="arrivedAt">{t('arrivedAt')}</Label>
              <Input id="arrivedAt" name="arrivedAt" type="date" />
              <p className="text-xs text-muted-foreground">{t('arrivedAtHint')}</p>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending || !productId}>
              {isPending ? tCommon('saving') : t('register')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
