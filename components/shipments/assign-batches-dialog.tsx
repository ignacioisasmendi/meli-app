'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PackagePlus } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatDate, formatUsd } from '@/lib/utils'
import { assignBatches, getUnassignedBatches } from '@/actions/shipments'

interface UnassignedBatch {
  id: string
  quantity: number
  unitCostUsd: number
  purchasedAt: Date
  product: { name: string; sku: string }
}

/** Puts already-registered purchases into this box. */
export function AssignBatchesDialog({ shipmentId }: { shipmentId: string }) {
  const t = useTranslations('AssignBatches')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [batches, setBatches] = useState<UnassignedBatch[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  /** Loading on open rather than in an effect — the fetch is caused by the
   *  click, not by state the dialog needs to stay in sync with. */
  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    setBatches(null)
    setSelected(new Set())
    getUnassignedBatches()
      .then(setBatches)
      .catch(() => toast.error(t('couldNotLoad')))
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onAssign() {
    startTransition(async () => {
      const res = await assignBatches([...selected], shipmentId)
      if (res.ok) {
        toast.success(t('addedPurchases', { count: selected.size }))
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
          {t('addPurchases')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('addPurchasesToShipment')}</DialogTitle>
          <DialogDescription>{t('unassignedExplainer')}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-80 pr-4">
          {batches === null && <p className="py-6 text-center text-sm text-muted-foreground">{t('loading')}</p>}
          {batches?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('nothingUnassigned')}</p>
          )}
          <div className="space-y-1">
            {batches?.map((b) => (
              <label
                key={b.id}
                className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted"
              >
                <Checkbox checked={selected.has(b.id)} onCheckedChange={() => toggle(b.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{b.product.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {b.product.sku} · {t('unitsCount', { count: b.quantity })} ·{' '}
                    {t('perUnit', { value: formatUsd(b.unitCostUsd) })} · {formatDate(b.purchasedAt)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button onClick={onAssign} disabled={pending || selected.size === 0}>
            {pending ? t('addingEllipsis') : t('addCount', { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
