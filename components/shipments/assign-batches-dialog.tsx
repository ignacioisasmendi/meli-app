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
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/utils'
import { addPurchasesToShipment, getUnassignedBatches } from '@/actions/shipments'

interface UnassignedBatch {
  id: string
  quantity: number
  purchasedAt: Date
  product: { name: string; sku: string }
  purchase: {
    purchasedAt: Date
    arrivedAt: Date | null
    order: { orderNumber: string } | null
  } | null
}

/**
 * Arrived purchases first, oldest arrival on top, so the units that reached the
 * courier on the same day sit together; purchases still on their way go last.
 */
function byArrival(a: UnassignedBatch, b: UnassignedBatch) {
  const aa = a.purchase?.arrivedAt ? new Date(a.purchase.arrivedAt).getTime() : Infinity
  const ba = b.purchase?.arrivedAt ? new Date(b.purchase.arrivedAt).getTime() : Infinity
  if (aa !== ba) return aa - ba
  return new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime()
}

/** Puts already-registered purchases into this box, whole or in part. */
export function AssignBatchesDialog({ shipmentId }: { shipmentId: string }) {
  const t = useTranslations('AssignBatches')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [batches, setBatches] = useState<UnassignedBatch[] | null>(null)
  /** Selected batch → units going into the box, as typed. */
  const [selected, setSelected] = useState<Map<string, string>>(new Map())

  /** Loading on open rather than in an effect — the fetch is caused by the
   *  click, not by state the dialog needs to stay in sync with. */
  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    setBatches(null)
    setSelected(new Map())
    getUnassignedBatches()
      .then((rows) => setBatches([...rows].sort(byArrival)))
      .catch(() => toast.error(t('couldNotLoad')))
  }

  function toggle(batch: UnassignedBatch) {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(batch.id)) next.delete(batch.id)
      else next.set(batch.id, String(batch.quantity))
      return next
    })
  }

  function setQuantity(id: string, value: string) {
    setSelected((prev) => new Map(prev).set(id, value))
  }

  const lines = [...selected].map(([batchId, qty]) => ({ batchId, quantity: Number(qty) }))
  const valid =
    lines.length > 0 &&
    lines.every((l) => {
      const max = batches?.find((b) => b.id === l.batchId)?.quantity ?? 0
      return Number.isInteger(l.quantity) && l.quantity > 0 && l.quantity <= max
    })
  const units = lines.reduce((n, l) => n + (Number.isFinite(l.quantity) ? l.quantity : 0), 0)

  function onAssign() {
    startTransition(async () => {
      const res = await addPurchasesToShipment({ shipmentId, lines })
      if (res.ok) {
        toast.success(t('addedPurchases', { count: lines.length }))
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
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('addPurchasesToShipment')}</DialogTitle>
          <DialogDescription>{t('unassignedExplainer')}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-96 rounded-md border">
          {batches === null && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('loading')}</p>
          )}
          {batches?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('nothingUnassigned')}</p>
          )}
          {batches && batches.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t('product')}</TableHead>
                  <TableHead className="text-right">{t('quantity')}</TableHead>
                  <TableHead>{t('purchasedAt')}</TableHead>
                  <TableHead>{t('arrivedAt')}</TableHead>
                  <TableHead className="w-40">{t('going')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => {
                  const qty = selected.get(b.id)
                  const isSelected = qty !== undefined
                  const n = Number(qty)
                  const partial = isSelected && Number.isInteger(n) && n > 0 && n < b.quantity
                  return (
                    <TableRow key={b.id} data-state={isSelected ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox checked={isSelected} onCheckedChange={() => toggle(b)} />
                      </TableCell>
                      <TableCell>
                        <span className="block max-w-56 truncate text-sm font-medium">
                          {b.product.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {b.product.sku}
                          {b.purchase?.order ? ` · ${b.purchase.order.orderNumber}` : ''}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{b.quantity}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(b.purchase?.purchasedAt ?? b.purchasedAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {b.purchase?.arrivedAt ? formatDate(b.purchase.arrivedAt) : '—'}
                      </TableCell>
                      <TableCell>
                        {isSelected ? (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={1}
                              max={b.quantity}
                              value={qty}
                              onChange={(e) => setQuantity(b.id, e.target.value)}
                              className="h-8 w-16"
                              aria-label={t('going')}
                            />
                            {partial ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-xs"
                                onClick={() => setQuantity(b.id, String(b.quantity))}
                              >
                                {t('whole')}
                              </Button>
                            ) : (
                              <span className="px-2 text-xs text-muted-foreground">{t('whole')}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {partial && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {t('restStays', { count: b.quantity - n })}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button onClick={onAssign} disabled={pending || !valid}>
            {pending ? t('addingEllipsis') : t('addUnits', { count: units })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
