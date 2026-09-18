'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PackagePlus } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  ReceivedStockPicker,
  fullQuantitiesValid,
  toFullLines,
  type FullQuantities,
} from '@/components/full-shipments/received-stock-picker'
import { addProductsToFull, getReceivedStockForFull } from '@/actions/full-shipments'
import type { ReceivedProduct } from '@/lib/inventory/full-shipments'

/** Adds more received stock, per product, to this Full box. */
export function AddProductsDialog({ fullShipmentId }: { fullShipmentId: string }) {
  const t = useTranslations('AddProductsToFull')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [products, setProducts] = useState<ReceivedProduct[] | null>(null)
  const [quantities, setQuantities] = useState<FullQuantities>({})

  const lines = toFullLines(quantities)
  const valid = products !== null && lines.length > 0 && fullQuantitiesValid(products, quantities)

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    setProducts(null)
    setQuantities({})
    getReceivedStockForFull()
      .then(setProducts)
      .catch(() => toast.error(t('couldNotLoad')))
  }

  function onAdd() {
    startTransition(async () => {
      const res = await addProductsToFull(fullShipmentId, lines)
      if (res.ok) {
        toast.success(t('added', { count: lines.length }))
        setOpen(false)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <PackagePlus className="size-4" />
          {t('addProducts')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('addProductsToFull')}</DialogTitle>
          <DialogDescription>{t('explainer')}</DialogDescription>
        </DialogHeader>

        <ReceivedStockPicker products={products} quantities={quantities} onChange={setQuantities} />

        <DialogFooter>
          <Button onClick={onAdd} disabled={pending || !valid}>
            {pending ? t('adding') : t('add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
