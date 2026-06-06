'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { linkListing } from '@/actions/accounts'

const UNLINKED = '__none__'

export function ListingLinkSelect({
  listingId,
  productId,
  products,
}: {
  listingId: string
  productId: string | null
  products: { id: string; name: string; sku: string }[]
}) {
  const [isPending, startTransition] = useTransition()

  function onChange(value: string) {
    const next = value === UNLINKED ? null : value
    startTransition(async () => {
      const result = await linkListing(listingId, next)
      if (result.ok) toast.success('Listing updated')
      else toast.error(result.error)
    })
  }

  return (
    <Select
      value={productId ?? UNLINKED}
      onValueChange={onChange}
      disabled={isPending}
    >
      <SelectTrigger className="h-8 w-64">
        <SelectValue placeholder="Not linked" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNLINKED}>Not linked</SelectItem>
        {products.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name} ({p.sku})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
