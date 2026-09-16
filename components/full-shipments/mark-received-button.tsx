'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { markFullShipmentReceived } from '@/actions/full-shipments'

/** Manual override for confirming receipt without waiting on the sync cron. */
export function MarkReceivedButton({ fullShipmentId }: { fullShipmentId: string }) {
  const t = useTranslations('FullShipmentDetail')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      const res = await markFullShipmentReceived(fullShipmentId)
      if (res.ok) {
        toast.success(t('markedReceived'))
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <Button variant="outline" onClick={onClick} disabled={pending}>
      <CheckCircle2 className="size-4" />
      {t('markReceived')}
    </Button>
  )
}
