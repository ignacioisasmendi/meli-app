'use client'

import { useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatArs } from '@/lib/utils'
import { updateUsdArsRate, refreshRate } from '@/actions/settings'

export function RateForm({ rate }: { rate: number }) {
  const [isSaving, startSave] = useTransition()
  const [isRefreshing, startRefresh] = useTransition()

  function onSubmit(formData: FormData) {
    startSave(async () => {
      const result = await updateUsdArsRate(formData)
      if (result.ok) toast.success('Fallback rate updated')
      else toast.error(result.error)
    })
  }

  function onRefresh() {
    startRefresh(async () => {
      const result = await refreshRate()
      if (result.ok) toast.success('Rate refreshed from Saldo')
      else toast.error(result.error)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div>
          <p className="text-sm text-muted-foreground">Active rate (Saldo → Zelle)</p>
          <p className="text-2xl font-semibold">{formatArs(rate)} / USD</p>
        </div>
        <Button type="button" variant="outline" onClick={onRefresh} disabled={isRefreshing}>
          <RefreshCw className="size-4" />
          {isRefreshing ? 'Refreshing…' : 'Refresh now'}
        </Button>
      </div>

      <form action={onSubmit} className="flex max-w-sm items-end gap-3">
        <div className="grid flex-1 gap-2">
          <Label htmlFor="usdArsRate">Manual fallback rate</Label>
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
        <Button type="submit" variant="secondary" disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </div>
  )
}
