'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BATCH_LOCATION_VALUES, type BatchLocation } from '@/lib/statuses'
import { updateBatchStatus } from '@/actions/inventory'

/** Status picker for a batch loaded without a purchase — see `updateBatchStatus`. */
export function BatchStatusSelect({
  batchId,
  status,
}: {
  batchId: string
  status: BatchLocation
}) {
  const t = useTranslations('Status')
  const tCommon = useTranslations('Common')
  const [isPending, startTransition] = useTransition()

  function onChange(value: string) {
    startTransition(async () => {
      const result = await updateBatchStatus(batchId, value as BatchLocation)
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
        {BATCH_LOCATION_VALUES.map((value) => (
          <SelectItem key={value} value={value}>
            {t(value)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
