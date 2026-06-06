'use client'

import { useState, useTransition } from 'react'
import { SlidersHorizontal } from 'lucide-react'
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
import { adjustStock } from '@/actions/inventory'

export function AdjustStockDialog({
  productId,
  productName,
}: {
  productId: string
  productName: string
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function onSubmit(formData: FormData) {
    formData.set('productId', productId)
    startTransition(async () => {
      const result = await adjustStock(formData)
      if (result.ok) {
        toast.success('Stock adjusted')
        setOpen(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Adjust stock">
          <SlidersHorizontal className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>Adjust stock</DialogTitle>
            <DialogDescription>{productName}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="delta">Adjustment (±)</Label>
              <Input
                id="delta"
                name="delta"
                type="number"
                placeholder="e.g. -2 or 5"
                required
              />
              <p className="text-xs text-muted-foreground">
                Positive adds units, negative removes them.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="note">Note</Label>
              <Input id="note" name="note" placeholder="Reason (optional)" />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : 'Apply'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
