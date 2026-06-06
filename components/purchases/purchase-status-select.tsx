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
import { updatePurchaseStatus } from '@/actions/purchases'

export function PurchaseStatusSelect({
  purchaseId,
  status,
}: {
  purchaseId: string
  status: PurchaseStatus
}) {
  const [isPending, startTransition] = useTransition()

  function onChange(value: string) {
    startTransition(async () => {
      const result = await updatePurchaseStatus(purchaseId, value as PurchaseStatus)
      if (result.ok) toast.success('Status updated')
      else toast.error(result.error)
    })
  }

  return (
    <Select value={status} onValueChange={onChange} disabled={isPending}>
      <SelectTrigger className="h-8 w-36">
        <SelectValue />
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
