'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PackagePlus } from 'lucide-react'
import { toast } from 'sonner'
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
      .catch(() => toast.error('Could not load purchases'))
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
        toast.success(`Added ${selected.size} purchase${selected.size === 1 ? '' : 's'}`)
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
          Add purchases
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add purchases to this shipment</DialogTitle>
          <DialogDescription>
            Purchases that haven’t left for Argentina in another box yet.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-80 pr-4">
          {batches === null && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
          {batches?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing unassigned — every purchase is already in a shipment.
            </p>
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
                    {b.product.sku} · {b.quantity} units · {formatUsd(b.unitCostUsd)}/unit ·{' '}
                    {formatDate(b.purchasedAt)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button onClick={onAssign} disabled={pending || selected.size === 0}>
            {pending ? 'Adding…' : `Add ${selected.size || ''}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
