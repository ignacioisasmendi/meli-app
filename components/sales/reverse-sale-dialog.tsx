'use client'

import { useState, useTransition } from 'react'
import { Undo2 } from 'lucide-react'
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
import { cancelSaleManually, openReturnManually } from '@/actions/sales'

/**
 * Manual reversal, for sales Mercado Libre never told us about — an off-platform
 * agreement, or a claim webhook that never arrived.
 *
 * The two buttons are the two stock outcomes: a cancellation never shipped so it
 * restocks now, while a return has to wait for the box to turn up.
 */
export function ReverseSaleDialog({
  saleId,
  productName,
  quantity,
}: {
  saleId: string
  productName: string
  quantity: number
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function submit(formData: FormData, kind: 'cancel' | 'return') {
    formData.set('saleId', saleId)
    startTransition(async () => {
      const result =
        kind === 'cancel'
          ? await cancelSaleManually(formData)
          : await openReturnManually(formData)
      if (result.ok) {
        toast.success(
          kind === 'cancel' ? 'Sale cancelled and restocked' : 'Return opened'
        )
        setOpen(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Reverse sale">
          <Undo2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form>
          <DialogHeader>
            <DialogTitle>Reverse sale</DialogTitle>
            <DialogDescription>
              {productName} — {quantity} unit{quantity === 1 ? '' : 's'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="quantity">Units (returns only)</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min={1}
                max={quantity}
                defaultValue={quantity}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reason">Reason</Label>
              <Input id="reason" name="reason" placeholder="Why (optional)" />
            </div>
            <p className="text-xs text-muted-foreground">
              <strong>Cancel</strong> is for an order that never shipped — stock
              goes back immediately. <strong>Open return</strong> reverses the money
              now and waits for you to confirm the goods arrived.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="submit"
              variant="outline"
              disabled={isPending}
              formAction={(formData) => submit(formData, 'return')}
            >
              Open return
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={isPending}
              formAction={(formData) => submit(formData, 'cancel')}
            >
              {isPending ? 'Saving…' : 'Cancel sale'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
