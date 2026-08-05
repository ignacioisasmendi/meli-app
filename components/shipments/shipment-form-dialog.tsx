'use client'

import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { AllocationBasis } from '@prisma/client'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ALLOCATION_BASIS_HINTS, ALLOCATION_BASIS_OPTIONS } from '@/lib/statuses'
import { createShipment, updateShipment } from '@/actions/shipments'

interface ShipmentFormDialogProps {
  shipment?: {
    id: string
    code: string
    courier: string | null
    basis: AllocationBasis
    estimatedUsd: number
    notes: string | null
  }
  trigger?: React.ReactNode
}

export function ShipmentFormDialog({ shipment, trigger }: ShipmentFormDialogProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [basis, setBasis] = useState<AllocationBasis>(shipment?.basis ?? AllocationBasis.WEIGHT)
  const editing = Boolean(shipment)

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        const result = editing
          ? await updateShipment(shipment!.id, formData)
          : await createShipment(formData)
        if (result.ok) {
          toast.success(editing ? 'Shipment updated' : 'Shipment created')
          setOpen(false)
        } else {
          toast.error(result.error)
        }
      } catch {
        toast.error('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            New shipment
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit shipment' : 'New shipment'}</DialogTitle>
            <DialogDescription>
              A shipment is one physical box travelling to Argentina. Its freight bill gets
              split across whatever is inside once it lands.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  name="code"
                  defaultValue={shipment?.code}
                  placeholder="ENVIO-2026-03"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="courier">Courier</Label>
                <Input
                  id="courier"
                  name="courier"
                  defaultValue={shipment?.courier ?? ''}
                  placeholder="Aerobox, TiendaMía…"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="basis">Split freight</Label>
              <input type="hidden" name="basis" value={basis} />
              <Select value={basis} onValueChange={(v) => setBasis(v as AllocationBasis)}>
                <SelectTrigger id="basis">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALLOCATION_BASIS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ALLOCATION_BASIS_HINTS[basis]}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="estimatedUsd">Estimated freight (USD)</Label>
              <Input
                id="estimatedUsd"
                name="estimatedUsd"
                type="number"
                step="0.01"
                min={0}
                defaultValue={shipment?.estimatedUsd || ''}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">
                Optional. Lets you price listings while the box is still in transit — the
                actual bill replaces it on arrival.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                defaultValue={shipment?.notes ?? ''}
                placeholder="Tracking number, consolidator, anything worth remembering."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : editing ? 'Save changes' : 'Create shipment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
