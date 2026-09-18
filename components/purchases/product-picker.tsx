'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface ProductOption {
  id: string
  name: string
  sku: string
}

/** Value meaning "create a new product" rather than an existing one. */
export const NEW_PRODUCT = '__new__'

/**
 * Searchable product dropdown for mapping an imported line: filter by name or
 * SKU, or pick "new product". A plain Select stops being usable once the
 * catalog is more than a screenful.
 */
export function ProductPicker({
  products,
  value,
  onChange,
  className,
}: {
  products: ProductOption[]
  /** A product id, or `NEW_PRODUCT`. */
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const t = useTranslations('ProductPicker')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = value === NEW_PRODUCT ? null : products.find((p) => p.id === value)
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 50)
  }, [products, query])

  function pick(next: string) {
    onChange(next)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('justify-between font-normal', className)}
        >
          <span className="truncate">
            {selected ? selected.name : t('newProduct')}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search')}
            className="h-8"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          <button
            type="button"
            onClick={() => pick(NEW_PRODUCT)}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
          >
            <Plus className="size-4 shrink-0" />
            {t('newProduct')}
          </button>
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p.id)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <Check className={cn('size-4 shrink-0', p.id === value ? 'opacity-100' : 'opacity-0')} />
              <span className="flex-1 truncate">{p.name}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.sku}</span>
            </button>
          ))}
          {matches.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{t('noMatches')}</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
