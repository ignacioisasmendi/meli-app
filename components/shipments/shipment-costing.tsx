'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Check, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { AllocationBasis, ShipmentStatus } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatArs, formatGrams, formatUsd } from '@/lib/utils'
import { ALLOCATION_BASIS_HINTS, ALLOCATION_BASIS_OPTIONS } from '@/lib/statuses'
import { allocateFreight, arsToUsd } from '@/lib/inventory/shipment'
import { applyEstimate, assignBatches, costShipment, reopenShipment } from '@/actions/shipments'

export interface CostingBatch {
  id: string
  productId: string
  productName: string
  sku: string
  weightGrams: number | null
  quantity: number
  goodsUnitCostUsd: number
  unitCostUsd: number
}

const num = (s: string) => {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * The arrival step, and the thing this whole feature exists for: type in the
 * courier bill, see exactly what each product will cost once it is spread, then
 * commit. The table is the spreadsheet — it just writes itself back to the
 * batches instead of being copied by hand.
 */
export function ShipmentCosting({
  shipmentId,
  status,
  basis: initialBasis,
  estimatedUsd,
  freightUsd,
  customsUsd,
  otherUsd,
  localShippingArs,
  localShippingRate,
  usdArsRate,
  batches,
}: {
  shipmentId: string
  status: ShipmentStatus
  basis: AllocationBasis
  estimatedUsd: number
  freightUsd: number | null
  customsUsd: number | null
  otherUsd: number | null
  localShippingArs: number | null
  /** Rate frozen when this shipment was costed, if it has been. */
  localShippingRate: number | null
  /** Today's Saldo buy rate, for the live preview before costing. */
  usdArsRate: number
  batches: CostingBatch[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const costed = status === ShipmentStatus.COSTED
  const [freight, setFreight] = useState(freightUsd ? String(freightUsd) : '')
  const [customs, setCustoms] = useState(customsUsd ? String(customsUsd) : '')
  const [other, setOther] = useState(otherUsd ? String(otherUsd) : '')
  const [localArs, setLocalArs] = useState(localShippingArs ? String(localShippingArs) : '')
  const [basis, setBasis] = useState<AllocationBasis>(initialBasis)

  // A costed shipment shows the rate it was actually costed at, not today's.
  const rate = costed && localShippingRate ? localShippingRate : usdArsRate
  const localUsd = arsToUsd(num(localArs), rate)

  const bill = num(freight) + num(customs) + num(other) + localUsd

  const allocation = useMemo(
    () =>
      allocateFreight(
        batches.map((b) => ({
          quantity: b.quantity,
          unitWeightGrams: b.weightGrams,
          goodsUnitCostUsd: b.goodsUnitCostUsd,
        })),
        bill,
        basis
      ),
    [batches, bill, basis]
  )

  const totalUnits = batches.reduce((s, b) => s + b.quantity, 0)
  const totalGoods = batches.reduce((s, b) => s + b.quantity * b.goodsUnitCostUsd, 0)

  function onCost() {
    startTransition(async () => {
      const res = await costShipment(shipmentId, {
        freightUsd: num(freight),
        customsUsd: num(customs),
        otherUsd: num(other),
        localShippingArs: num(localArs),
        basis,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(
        `Landed costs updated across ${res.summary.productCount} product${res.summary.productCount === 1 ? '' : 's'} — stock is now in the warehouse`
      )
      if (res.summary.unitsAlreadySold > 0) {
        toast.warning(
          `${res.summary.unitsAlreadySold} unit${res.summary.unitsAlreadySold === 1 ? ' was' : 's were'} already sold from this shipment. Those sales keep the profit they were booked with.`
        )
      }
      router.refresh()
    })
  }

  function onEstimate() {
    startTransition(async () => {
      const res = await applyEstimate(shipmentId)
      if (res.ok) {
        toast.success(`Estimate of ${formatUsd(res.summary.totalBillUsd)} spread across the box`)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  function onRemove(batchId: string) {
    startTransition(async () => {
      const res = await assignBatches([batchId], null)
      if (res.ok) {
        toast.success('Removed from this shipment')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  function onReopen() {
    startTransition(async () => {
      const res = await reopenShipment(shipmentId)
      if (res.ok) {
        toast.success('Shipment reopened — costs stay as they are until you cost it again')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const missingWeights = batches.filter((b) => b.weightGrams == null || b.weightGrams <= 0)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle>{costed ? 'Freight bill' : 'Cost this shipment'}</CardTitle>
        {costed && (
          <Button variant="outline" size="sm" onClick={onReopen} disabled={pending}>
            <RotateCcw className="size-4" />
            Reopen to edit
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-2">
            <Label htmlFor="freight">Freight (USD)</Label>
            <Input
              id="freight"
              type="number"
              step="0.01"
              min={0}
              value={freight}
              onChange={(e) => setFreight(e.target.value)}
              placeholder="0.00"
              disabled={costed || pending}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="customs">Customs / duties (USD)</Label>
            <Input
              id="customs"
              type="number"
              step="0.01"
              min={0}
              value={customs}
              onChange={(e) => setCustoms(e.target.value)}
              placeholder="0.00"
              disabled={costed || pending}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="other">Other (USD)</Label>
            <Input
              id="other"
              type="number"
              step="0.01"
              min={0}
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="0.00"
              disabled={costed || pending}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="localArs">Local shipping (ARS)</Label>
            <Input
              id="localArs"
              type="number"
              step="0.01"
              min={0}
              value={localArs}
              onChange={(e) => setLocalArs(e.target.value)}
              placeholder="0"
              disabled={costed || pending}
            />
            <p className="text-xs text-muted-foreground">
              {num(localArs) > 0 ? (
                <>
                  = <span className="font-medium text-foreground">{formatUsd(localUsd)}</span> at{' '}
                  {formatArs(rate)}/USD
                  {costed && localShippingRate ? ' (rate when costed)' : ''}
                </>
              ) : (
                <>Converted at the Saldo buy rate, {formatArs(rate)}/USD.</>
              )}
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:max-w-xs">
          <Label htmlFor="costing-basis">Split by</Label>
          <Select
            value={basis}
            onValueChange={(v) => setBasis(v as AllocationBasis)}
            disabled={costed || pending}
          >
            <SelectTrigger id="costing-basis">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALLOCATION_BASIS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{ALLOCATION_BASIS_HINTS[basis]}</p>
        </div>

        {allocation.fallbackReason && (
          <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">{allocation.fallbackReason}</p>
              {missingWeights.length > 0 && (
                <p className="text-muted-foreground">
                  Add a unit weight to{' '}
                  {missingWeights.map((b, i) => (
                    <span key={b.id}>
                      {i > 0 && ', '}
                      <Link
                        href={`/products/${b.productId}`}
                        className="underline underline-offset-2"
                      >
                        {b.productName}
                      </Link>
                    </span>
                  ))}{' '}
                  to split this bill by weight instead.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Share</TableHead>
                <TableHead className="text-right">Goods/unit</TableHead>
                <TableHead className="text-right">Freight/unit</TableHead>
                <TableHead className="text-right">Landed/unit</TableHead>
                <TableHead className="text-right">Line total</TableHead>
                {!costed && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={costed ? 8 : 9} className="py-10 text-center text-muted-foreground">
                    Nothing in this shipment yet.
                  </TableCell>
                </TableRow>
              )}
              {batches.map((b, i) => {
                const line = allocation.lines[i]
                const changed = Math.abs(line.unitCostUsd - b.unitCostUsd) >= 0.01
                return (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/products/${b.productId}`}
                        className="hover:underline underline-offset-2"
                      >
                        {b.productName}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {b.sku}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{b.quantity}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {b.weightGrams ? formatGrams(b.weightGrams * b.quantity) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {(line.share * 100).toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatUsd(b.goodsUnitCostUsd)}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.freightUnitCostUsd > 0 ? `+ ${formatUsd(line.freightUnitCostUsd)}` : '—'}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatUsd(line.unitCostUsd)}
                      {!costed && changed && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground line-through">
                          {formatUsd(b.unitCostUsd)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatUsd(line.unitCostUsd * b.quantity)}
                    </TableCell>
                    {!costed && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => onRemove(b.id)}
                          disabled={pending}
                        >
                          <X className="size-4" />
                          <span className="sr-only">Remove {b.productName}</span>
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 border-t pt-4">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Units</dt>
              <dd className="font-medium">{totalUnits}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Goods</dt>
              <dd className="font-medium">{formatUsd(totalGoods)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Freight bill</dt>
              <dd className="font-medium">{formatUsd(bill)}</dd>
              {localUsd > 0 && (
                <dd className="text-xs text-muted-foreground">
                  incl. {formatUsd(localUsd)} local
                </dd>
              )}
            </div>
            <div>
              <dt className="text-muted-foreground">Landed total</dt>
              <dd className="font-medium">{formatUsd(totalGoods + bill - allocation.residualUsd)}</dd>
            </div>
          </dl>

          {!costed && (
            <div className="flex gap-2">
              {estimatedUsd > 0 && (
                <Button variant="outline" onClick={onEstimate} disabled={pending}>
                  Apply {formatUsd(estimatedUsd)} estimate
                </Button>
              )}
              <Button onClick={onCost} disabled={pending || bill <= 0 || batches.length === 0}>
                <Check className="size-4" />
                {pending ? 'Applying…' : 'Apply & receive into warehouse'}
              </Button>
            </div>
          )}
        </div>

        {allocation.residualUsd !== 0 && bill > 0 && (
          <p className="text-xs text-muted-foreground">
            {formatUsd(Math.abs(allocation.residualUsd))} of the bill{' '}
            {allocation.residualUsd > 0 ? 'is left over' : 'is over-allocated'} because the split
            doesn’t divide evenly into whole cents per unit.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
