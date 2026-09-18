'use client'

import { useState, useTransition } from 'react'
import { ArrowRightLeft } from 'lucide-react'
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
import { moveStockToFull } from '@/actions/inventory'

/**
 * Moves units of a product into Full (from the depot) or back, without a Full
 * box — for stock that is already sitting in Full.
 */
export function MoveFullDialog({
  productId,
  productName,
  max,
  toFull,
}: {
  productId: string
  productName: string
  /** Units that can move in this direction. */
  max: number
  toFull: boolean
}) {
  const t = useTranslations('MoveFull')
  const tCommon = useTranslations('Common')
  const [open, setOpen] = useState(false)
  const [quantity, setQuantity] = useState(String(max))
  const [isPending, startTransition] = useTransition()

  function onSubmit() {
    startTransition(async () => {
      const result = await moveStockToFull({ productId, quantity: Number(quantity), toFull })
      if (result.ok) {
        toast.success(toFull ? t('movedToFull') : t('movedToDepot'))
        setOpen(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  const title = toFull ? t('sendToFull') : t('backToDepot')

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setQuantity(String(max))
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={title} title={title} disabled={max <= 0}>
          <ArrowRightLeft className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{productName}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor={`move-${productId}`}>{t('quantity')}</Label>
              <Input
                id={`move-${productId}`}
                type="number"
                min={1}
                max={max}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                {toFull ? t('toFullHint', { max }) : t('toDepotHint', { max })}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? tCommon('saving') : t('move')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
