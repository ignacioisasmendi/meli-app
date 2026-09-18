'use client'

import { useState, useTransition } from 'react'
import { PackagePlus } from 'lucide-react'
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
import { addStockWithCost } from '@/actions/inventory'

interface ProductOption {
  id: string
  name: string
}

export function AddStockDialog({ products }: { products: ProductOption[] }) {
  const t = useTranslations('AddStock')
  const tStatus = useTranslations('Status')
  const tCommon = useTranslations('Common')
  const [open, setOpen] = useState(false)
  const [productId, setProductId] = useState('')
  const [status, setStatus] = useState('AVAILABLE')
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
    formData.set('costMode', costMode)
    formData.set('status', status)
    startTransition(async () => {
      const result = await addStockWithCost(formData)
      if (result.ok) {
        toast.success(t('stockAdded'))
        setOpen(false)
        setProductId('')
        setStatus('AVAILABLE')
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
          <PackagePlus className="size-4" />
          {t('addStock')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>{t('addStock')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
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
                  <Label htmlFor="add-quantity">{t('quantity')}</Label>
                  <Input
                    id="add-quantity"
                    name="quantity"
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="add-cost">
                    {costMode === 'unit' ? t('unitCostUsd') : t('totalCostUsd')}
                  </Label>
                  <Input
                    id="add-cost"
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
                <Label htmlFor="add-receivedAt">{t('receivedAt')}</Label>
                <Input id="add-receivedAt" name="receivedAt" type="date" />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{t('statusHint')}</p>

            <div className="grid gap-2">
              <Label htmlFor="add-note">{t('note')}</Label>
              <Input id="add-note" name="note" placeholder={t('notePlaceholder')} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending || !productId}>
              {isPending ? tCommon('saving') : t('add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
