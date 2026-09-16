'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { PurchaseStatus } from '@prisma/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PURCHASE_STATUS_VALUES } from '@/lib/statuses'
import { updateOrderStatus } from '@/actions/purchases'

/**
 * Status for a whole order. `status` is null when its lines disagree — picking
 * one then puts every line back in step.
 */
export function OrderStatusSelect({
  orderId,
  status,
  lineCount,
}: {
  orderId: string
  status: PurchaseStatus | null
  lineCount: number
}) {
  const t = useTranslations('Status')
  const tOrder = useTranslations('OrderStatusSelect')
  const [isPending, startTransition] = useTransition()

  function onChange(value: string) {
    startTransition(async () => {
      const result = await updateOrderStatus(orderId, value as PurchaseStatus)
      if (result.ok) {
        toast.success(tOrder('linesUpdated', { count: lineCount }))
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Select value={status ?? undefined} onValueChange={onChange} disabled={isPending}>
      <SelectTrigger className="h-8 w-36">
        <SelectValue placeholder={tOrder('mixed')} />
      </SelectTrigger>
      <SelectContent>
        {PURCHASE_STATUS_VALUES.map((value) => (
          <SelectItem key={value} value={value}>
            {t(value)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
