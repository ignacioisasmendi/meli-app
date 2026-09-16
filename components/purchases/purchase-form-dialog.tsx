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
import { PURCHASE_STATUS_VALUES } from '@/lib/statuses'
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
  const [isPending, startTransition] = useTransition()

  function onSubmit(formData: FormData) {
    formData.set('productId', productId)
    formData.set('status', status)
    startTransition(async () => {
      const result = await registerPurchase(formData)
      if (result.ok) {
        toast.success(t('purchaseRegistered'))
        setOpen(false)
        setProductId('')
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

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="quantity">{t('quantity')}</Label>
                <Input id="quantity" name="quantity" type="number" min={1} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="unitCostUsd">{t('unitCostUsd')}</Label>
                <Input
                  id="unitCostUsd"
                  name="unitCostUsd"
                  type="number"
                  step="0.01"
                  min={0}
                  required
                />
              </div>
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
