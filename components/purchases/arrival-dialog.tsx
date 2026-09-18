'use client'

import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { CalendarCheck } from 'lucide-react'
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
import { registerArrival } from '@/actions/purchases'

export function ArrivalDialog({
  purchaseId,
  productName,
  quantity,
  arrivedAt,
  arrivedAtLabel,
}: {
  purchaseId: string
  productName: string
  quantity: number
  /** `yyyy-MM-dd`, when the purchase already arrived. */
  arrivedAt: string | null
  /** The same date, formatted for the table cell. */
  arrivedAtLabel: string | null
}) {
  const t = useTranslations('Arrival')
  const tCommon = useTranslations('Common')
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(arrivedAt ?? '')
  const [units, setUnits] = useState(String(quantity))
  const [isPending, startTransition] = useTransition()

  const arrived = arrivedAt != null
  const n = Number(units)
  const rest = Number.isInteger(n) && n > 0 && n < quantity ? quantity - n : 0

  function onOpenChange(next: boolean) {
    if (next) {
      setDate(arrivedAt ?? format(new Date(), 'yyyy-MM-dd'))
      setUnits(String(quantity))
    }
    setOpen(next)
  }

  function onSubmit() {
    startTransition(async () => {
      const result = await registerArrival({ purchaseId, arrivedAt: date, quantity: n })
      if (result.ok) {
        toast.success(rest > 0 ? t('splitDone', { arrived: n, rest }) : t('saved'))
        setOpen(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {arrived ? (
          <Button variant="ghost" size="sm" className="-ml-2 h-8 font-normal">
            {arrivedAtLabel}
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="h-8">
            <CalendarCheck className="size-4" />
            {t('register')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{arrived ? t('editTitle') : t('title')}</DialogTitle>
          <DialogDescription>
            {productName} · {t('units', { count: quantity })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor={`arrivedAt-${purchaseId}`}>{t('date')}</Label>
            <Input
              id={`arrivedAt-${purchaseId}`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`arrivedQty-${purchaseId}`}>{t('quantity')}</Label>
            <Input
              id={`arrivedQty-${purchaseId}`}
              type="number"
              min={1}
              max={quantity}
              value={units}
              disabled={arrived}
              onChange={(e) => setUnits(e.target.value)}
            />
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            {arrived ? t('editHint') : rest > 0 ? t('splitHint', { arrived: n, rest }) : t('hint')}
          </p>
        </div>

        <DialogFooter>
          <Button onClick={onSubmit} disabled={isPending || !date || !(n > 0 && n <= quantity)}>
            {isPending ? tCommon('saving') : tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
