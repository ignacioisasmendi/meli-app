'use client'

import { useState, useTransition } from 'react'
import { CalendarClock } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { updateEstimatedArrival } from '@/actions/purchases'

/**
 * The expected courier arrival of a line that hasn't arrived yet — a guess set
 * at import and revised here. Saving only moves the date; the real arrival is
 * still registered with `ArrivalDialog`.
 */
export function EstimatedArrival({
  purchaseId,
  estimatedArrivalAt,
  estimatedArrivalLabel,
  inOrder,
}: {
  purchaseId: string
  /** `yyyy-MM-dd`, or null when there is no estimate yet. */
  estimatedArrivalAt: string | null
  /** The same date, formatted for the table cell. */
  estimatedArrivalLabel: string | null
  /** Whether the line belongs to a supplier order, which enables "whole order". */
  inOrder: boolean
}) {
  const t = useTranslations('EstimatedArrival')
  const tCommon = useTranslations('Common')
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(estimatedArrivalAt ?? '')
  const [wholeOrder, setWholeOrder] = useState(inOrder)
  const [isPending, startTransition] = useTransition()

  function onOpenChange(next: boolean) {
    if (next) {
      setDate(estimatedArrivalAt ?? '')
      setWholeOrder(inOrder)
    }
    setOpen(next)
  }

  function save(value: string) {
    startTransition(async () => {
      const result = await updateEstimatedArrival({
        purchaseId,
        estimatedArrivalAt: value,
        wholeOrder,
      })
      if (result.ok) {
        toast.success(value ? t('saved') : t('cleared'))
        setOpen(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <CalendarClock className="size-3" />
          {estimatedArrivalLabel ? t('label', { date: estimatedArrivalLabel }) : t('add')}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3">
        <div className="grid gap-2">
          <Label htmlFor={`eta-${purchaseId}`}>{t('title')}</Label>
          <Input
            id={`eta-${purchaseId}`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>
        {inOrder && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`eta-order-${purchaseId}`}
              checked={wholeOrder}
              onCheckedChange={(v) => setWholeOrder(v === true)}
            />
            <Label htmlFor={`eta-order-${purchaseId}`} className="text-xs font-normal">
              {t('wholeOrder')}
            </Label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          {estimatedArrivalAt && (
            <Button variant="ghost" size="sm" disabled={isPending} onClick={() => save('')}>
              {t('clear')}
            </Button>
          )}
          <Button size="sm" disabled={isPending || !date} onClick={() => save(date)}>
            {isPending ? tCommon('saving') : tCommon('save')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
