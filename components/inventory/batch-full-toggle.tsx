'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { setBatchInFull } from '@/actions/inventory'

/** Moves a received batch into Full, or back to the depot, without a Full box. */
export function BatchFullToggle({ batchId, inFull }: { batchId: string; inFull: boolean }) {
  const t = useTranslations('BatchFull')
  const [isPending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      const result = await setBatchInFull(batchId, !inFull)
      if (result.ok) toast.success(inFull ? t('movedToDepot') : t('movedToFull'))
      else toast.error(result.error)
    })
  }

  return (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClick} disabled={isPending}>
      {inFull ? t('moveToDepot') : t('moveToFull')}
    </Button>
  )
}
