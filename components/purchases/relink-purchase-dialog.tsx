'use client'

import { useMemo, useState, useTransition } from 'react'
import { Link2 } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { relinkPurchase } from '@/actions/purchases'

interface ProductOption {
  id: string
  name: string
  sku: string
}

/**
 * Moves a purchase onto the product it should have been imported as — its
 * batches and stock go with it, no SKU editing involved.
 */
export function RelinkPurchaseDialog({
  purchaseId,
  currentProduct,
  quantity,
  products,
}: {
  purchaseId: string
  currentProduct: ProductOption
  quantity: number
  products: ProductOption[]
}) {
  const t = useTranslations('RelinkPurchase')
  const tCommon = useTranslations('Common')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [archiveEmptied, setArchiveEmptied] = useState(true)
  const [isPending, startTransition] = useTransition()

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products
      .filter((p) => p.id !== currentProduct.id)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 50)
  }, [products, currentProduct.id, query])

  function onOpenChange(next: boolean) {
    if (next) {
      setQuery('')
      setSelected(null)
      setArchiveEmptied(true)
    }
    setOpen(next)
  }

  function onSubmit() {
    if (!selected) return
    startTransition(async () => {
      const result = await relinkPurchase({ purchaseId, productId: selected, archiveEmptied })
      if (result.ok) {
        toast.success(t('done'))
        setOpen(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground"
          title={t('trigger')}
        >
          <Link2 className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('description', {
              name: currentProduct.name,
              sku: currentProduct.sku,
              count: quantity,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search')}
          />
          <div className="max-h-64 overflow-y-auto rounded-md border">
            {matches.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">{t('noMatches')}</p>
            ) : (
              matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p.id)}
                  className={cn(
                    'flex w-full items-baseline justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted',
                    selected === p.id && 'bg-muted font-medium'
                  )}
                >
                  <span>{p.name}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.sku}</span>
                </button>
              ))
            )}
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id={`archive-${purchaseId}`}
              checked={archiveEmptied}
              onCheckedChange={(v) => setArchiveEmptied(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor={`archive-${purchaseId}`} className="text-xs font-normal leading-snug">
              {t('archiveEmptied', { name: currentProduct.name })}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>

        <DialogFooter>
          <Button onClick={onSubmit} disabled={isPending || !selected}>
            {isPending ? tCommon('saving') : t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
