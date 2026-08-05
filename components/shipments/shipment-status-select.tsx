'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { ShipmentStatus } from '@prisma/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SHIPMENT_STATUS_OPTIONS } from '@/lib/statuses'
import { updateShipmentStatus } from '@/actions/shipments'

/**
 * Moves a shipment along its journey. Costed shipments are read-only here —
 * they leave that state only by being reopened.
 */
export function ShipmentStatusSelect({
  shipmentId,
  status,
}: {
  shipmentId: string
  status: ShipmentStatus
}) {
  const [isPending, startTransition] = useTransition()

  function onChange(value: string) {
    startTransition(async () => {
      const result = await updateShipmentStatus(shipmentId, value as ShipmentStatus)
      if (result.ok) toast.success('Shipment updated')
      else toast.error(result.error)
    })
  }

  return (
    <Select
      value={status}
      onValueChange={onChange}
      disabled={isPending || status === ShipmentStatus.COSTED}
    >
      <SelectTrigger className="h-8 w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SHIPMENT_STATUS_OPTIONS.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
