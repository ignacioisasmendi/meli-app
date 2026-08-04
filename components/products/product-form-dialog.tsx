'use client'

import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
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
import { createProduct, updateProduct } from '@/actions/products'

interface ProductFormDialogProps {
  product?: {
    id: string
    sku: string
    name: string
    brand: string | null
    minStock: number
  }
  trigger?: React.ReactNode
}

export function ProductFormDialog({ product, trigger }: ProductFormDialogProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const editing = Boolean(product)

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        const result = editing
          ? await updateProduct(product!.id, formData)
          : await createProduct(formData)
        if (result.ok) {
          toast.success(editing ? 'Product updated' : 'Product created')
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
            New product
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit product' : 'New product'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update the product details.' : 'Add a product to the catalog.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="sku">SKU</Label>
              <Input id="sku" name="sku" defaultValue={product?.sku} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={product?.name} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="brand">Brand</Label>
              <Input id="brand" name="brand" defaultValue={product?.brand ?? ''} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="minStock">Minimum stock</Label>
              <Input
                id="minStock"
                name="minStock"
                type="number"
                min={0}
                defaultValue={product?.minStock ?? 5}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : editing ? 'Save changes' : 'Create product'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
