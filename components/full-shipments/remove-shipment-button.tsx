'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { assignShipmentsToFull } from '@/actions/full-shipments'

export function RemoveShipmentButton({ shipmentId }: { shipmentId: string }) {
  const t = useTranslations('FullShipmentDetail')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      const res = await assignShipmentsToFull([shipmentId], null)
      if (res.ok) router.refresh()
      else toast.error(res.error)
    })
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      onClick={onClick}
      disabled={pending}
      title={t('removeShipment')}
    >
      <X className="size-4" />
    </Button>
  )
}
