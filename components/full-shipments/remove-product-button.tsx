'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { removeProductFromFull } from '@/actions/full-shipments'

export function RemoveProductButton({
  fullShipmentId,
  productId,
}: {
  fullShipmentId: string
  productId: string
}) {
  const t = useTranslations('FullShipmentDetail')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      const res = await removeProductFromFull(fullShipmentId, productId)
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
      title={t('removeProduct')}
    >
      <X className="size-4" />
      <span className="sr-only">{t('removeProduct')}</span>
    </Button>
  )
}
