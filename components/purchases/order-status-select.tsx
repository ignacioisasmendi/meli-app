'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { PurchaseStatus } from '@prisma/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PURCHASE_STATUS_OPTIONS } from '@/lib/statuses'
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
  const [isPending, startTransition] = useTransition()

  function onChange(value: string) {
    startTransition(async () => {
      const result = await updateOrderStatus(orderId, value as PurchaseStatus)
      if (result.ok) {
        toast.success(`${lineCount} line${lineCount === 1 ? '' : 's'} updated`)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Select value={status ?? undefined} onValueChange={onChange} disabled={isPending}>
      <SelectTrigger className="h-8 w-36">
        <SelectValue placeholder="Mixed" />
      </SelectTrigger>
      <SelectContent>
        {PURCHASE_STATUS_OPTIONS.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
