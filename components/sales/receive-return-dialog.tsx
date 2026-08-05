'use client'

import { useState, useTransition } from 'react'
import { PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
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
import { confirmReturnReceived } from '@/actions/sales'

/**
 * Confirms returned goods arrived. This is the step that actually restocks —
 * revenue was already reversed when the claim opened, so the only decision left
 * is whether the units can be sold again.
 */
export function ReceiveReturnDialog({
  saleId,
  productName,
  awaitingQuantity,
}: {
  saleId: string
  productName: string
  awaitingQuantity: number
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function submit(formData: FormData, resellable: boolean) {
    formData.set('saleId', saleId)
    formData.set('resellable', String(resellable))
    startTransition(async () => {
      const result = await confirmReturnReceived(formData)
      if (result.ok) {
        toast.success(resellable ? 'Return restocked' : 'Return written off')
        setOpen(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PackageCheck className="mr-2 size-4" />
          Receive
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form>
          <DialogHeader>
            <DialogTitle>Receive return</DialogTitle>
            <DialogDescription>
              {productName} — {awaitingQuantity} unit
              {awaitingQuantity === 1 ? '' : 's'} awaiting receipt.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="quantity">Units received</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min={1}
                max={awaitingQuantity}
                defaultValue={awaitingQuantity}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="note">Note</Label>
              <Input id="note" name="note" placeholder="Condition (optional)" />
            </div>
            <p className="text-xs text-muted-foreground">
              Restocking returns the units to their original batch at the cost they
              sold at. Writing off keeps them out of stock and books the cost as a
              loss.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="submit"
              variant="outline"
              disabled={isPending}
              formAction={(formData) => submit(formData, false)}
            >
              Not resellable
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              formAction={(formData) => submit(formData, true)}
            >
              {isPending ? 'Saving…' : 'Restock'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
