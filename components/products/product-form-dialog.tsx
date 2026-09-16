'use client'

import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
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
    weightGrams: number | null
  }
  trigger?: React.ReactNode
}

export function ProductFormDialog({ product, trigger }: ProductFormDialogProps) {
  const t = useTranslations('ProductForm')
  const tCommon = useTranslations('Common')
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
          toast.success(editing ? t('productUpdated') : t('productCreated'))
          setOpen(false)
        } else {
          toast.error(result.error)
        }
      } catch {
        toast.error(tCommon('somethingWentWrong'))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            {t('newProduct')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? t('editProduct') : t('newProduct')}</DialogTitle>
            <DialogDescription>
              {editing ? t('updateDetails') : t('addToCatalog')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="sku">{t('sku')}</Label>
              <Input id="sku" name="sku" defaultValue={product?.sku} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="name">{t('name')}</Label>
              <Input id="name" name="name" defaultValue={product?.name} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="brand">{t('brand')}</Label>
              <Input id="brand" name="brand" defaultValue={product?.brand ?? ''} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="minStock">{t('minimumStock')}</Label>
                <Input
                  id="minStock"
                  name="minStock"
                  type="number"
                  min={0}
                  defaultValue={product?.minStock ?? 5}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="weightGrams">{t('unitWeight')}</Label>
                <Input
                  id="weightGrams"
                  name="weightGrams"
                  type="number"
                  step="1"
                  min={0}
                  defaultValue={product?.weightGrams ?? ''}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">{t('weightHint')}</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? tCommon('saving') : editing ? tCommon('saveChanges') : t('createProduct')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
