'use client'

import { useState, useTransition } from 'react'
import { SlidersHorizontal } from 'lucide-react'
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
import { adjustStock } from '@/actions/inventory'

export function AdjustStockDialog({
  productId,
  productName,
}: {
  productId: string
  productName: string
}) {
  const t = useTranslations('AdjustStock')
  const tCommon = useTranslations('Common')
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function onSubmit(formData: FormData) {
    formData.set('productId', productId)
    startTransition(async () => {
      const result = await adjustStock(formData)
      if (result.ok) {
        toast.success(t('stockAdjusted'))
        setOpen(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('adjustStock')}>
          <SlidersHorizontal className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>{t('adjustStock')}</DialogTitle>
            <DialogDescription>{productName}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="delta">{t('adjustment')}</Label>
              <Input
                id="delta"
                name="delta"
                type="number"
                placeholder={t('adjustmentPlaceholder')}
                required
              />
              <p className="text-xs text-muted-foreground">{t('adjustmentHint')}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="note">{t('note')}</Label>
              <Input id="note" name="note" placeholder={t('notePlaceholder')} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? tCommon('saving') : t('apply')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
