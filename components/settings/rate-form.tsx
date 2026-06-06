'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateUsdArsRate } from '@/actions/settings'

export function RateForm({ rate }: { rate: number }) {
  const [isPending, startTransition] = useTransition()

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await updateUsdArsRate(formData)
      if (result.ok) toast.success('Rate updated')
      else toast.error(result.error)
    })
  }

  return (
    <form action={onSubmit} className="flex max-w-sm items-end gap-3">
      <div className="grid flex-1 gap-2">
        <Label htmlFor="usdArsRate">USD / ARS rate</Label>
        <Input
          id="usdArsRate"
          name="usdArsRate"
          type="number"
          step="0.01"
          min={0}
          defaultValue={rate}
          required
        />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}
