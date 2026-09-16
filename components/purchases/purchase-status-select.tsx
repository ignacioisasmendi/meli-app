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
import { updatePurchaseStatus } from '@/actions/purchases'

export function PurchaseStatusSelect({
  purchaseId,
  status,
}: {
  purchaseId: string
  status: PurchaseStatus
}) {
  const t = useTranslations('Status')
  const tCommon = useTranslations('Common')
  const [isPending, startTransition] = useTransition()

  function onChange(value: string) {
    startTransition(async () => {
      const result = await updatePurchaseStatus(purchaseId, value as PurchaseStatus)
      if (result.ok) toast.success(tCommon('statusUpdated'))
      else toast.error(result.error)
    })
  }

  return (
    <Select value={status} onValueChange={onChange} disabled={isPending}>
      <SelectTrigger className="h-8 w-36">
        <SelectValue />
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
