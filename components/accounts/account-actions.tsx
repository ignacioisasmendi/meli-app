'use client'

import { useTransition } from 'react'
import { RefreshCw, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { disconnectAccount, syncListings } from '@/actions/accounts'

export function AccountActions({ accountId }: { accountId: string }) {
  const [isPending, startTransition] = useTransition()

  function onSync() {
    startTransition(async () => {
      const result = await syncListings(accountId)
      if (result.ok) {
        const count = (result as { count?: number }).count ?? 0
        toast.success(`Synced ${count} listings`)
      } else {
        toast.error(result.error)
      }
    })
  }

  function onDisconnect() {
    startTransition(async () => {
      const result = await disconnectAccount(accountId)
      if (result.ok) toast.success('Account disconnected')
      else toast.error(result.error)
    })
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={onSync} disabled={isPending}>
        <RefreshCw className="size-4" />
        Sync listings
      </Button>
      <Button variant="ghost" size="sm" onClick={onDisconnect} disabled={isPending}>
        <Unplug className="size-4" />
        Disconnect
      </Button>
    </div>
  )
}
