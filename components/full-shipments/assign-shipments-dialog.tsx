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
import { assignShipmentsToFull, getShipmentsEligibleForFull } from '@/actions/full-shipments'

interface EligibleShipment {
  id: string
  code: string
  courier: string | null
  batches: Array<{ quantity: number; product: { id: string; name: string; sku: string } }>
}

/** Consolidates already-costed shipments into this Full box. */
export function AssignShipmentsDialog({ fullShipmentId }: { fullShipmentId: string }) {
  const t = useTranslations('AssignShipmentsToFull')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [shipments, setShipments] = useState<EligibleShipment[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    setShipments(null)
    setSelected(new Set())
    getShipmentsEligibleForFull()
      .then(setShipments)
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
      const res = await assignShipmentsToFull([...selected], fullShipmentId)
      if (res.ok) {
        toast.success(t('addedShipments', { count: selected.size }))
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
          {t('addShipments')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('addShipmentsToFull')}</DialogTitle>
          <DialogDescription>{t('eligibleExplainer')}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-80 pr-4">
          {shipments === null && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('loading')}</p>
          )}
          {shipments?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('nothingEligible')}</p>
          )}
          <div className="space-y-1">
            {shipments?.map((s) => {
              const units = s.batches.reduce((n, b) => n + b.quantity, 0)
              return (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted"
                >
                  <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.code}</span>
                    <span className="block text-xs text-muted-foreground">
                      {s.courier ?? '—'} · {t('unitsCount', { count: units })}
                    </span>
                  </span>
                </label>
              )
            })}
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
