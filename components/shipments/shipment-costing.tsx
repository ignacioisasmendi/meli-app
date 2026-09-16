'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Check, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
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
import { ALLOCATION_BASIS_VALUES } from '@/lib/statuses'
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
  const t = useTranslations('ShipmentCosting')
  const tBasis = useTranslations('AllocationBasis')
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
      toast.success(t('landedCostsUpdated', { count: res.summary.productCount }))
      if (res.summary.unitsAlreadySold > 0) {
        toast.warning(t('unitsAlreadySold', { count: res.summary.unitsAlreadySold }))
      }
      router.refresh()
    })
  }

  function onEstimate() {
    startTransition(async () => {
      const res = await applyEstimate(shipmentId)
      if (res.ok) {
        toast.success(t('estimateSpread', { value: formatUsd(res.summary.totalBillUsd) }))
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
        toast.success(t('removedFromShipment'))
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
        toast.success(t('shipmentReopened'))
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
        <CardTitle>{costed ? t('freightBill') : t('costThisShipment')}</CardTitle>
        {costed && (
          <Button variant="outline" size="sm" onClick={onReopen} disabled={pending}>
            <RotateCcw className="size-4" />
            {t('reopenToEdit')}
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-2">
            <Label htmlFor="freight">{t('freightUsd')}</Label>
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
            <Label htmlFor="customs">{t('customsUsd')}</Label>
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
            <Label htmlFor="other">{t('otherUsd')}</Label>
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
            <Label htmlFor="localArs">{t('localShippingArs')}</Label>
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
                  = <span className="font-medium text-foreground">{formatUsd(localUsd)}</span>{' '}
                  {t('atRate', { rate: formatArs(rate) })}
                  {costed && localShippingRate ? ` ${t('rateWhenCosted')}` : ''}
                </>
              ) : (
                <>{t('convertedAtSaldoRate', { rate: formatArs(rate) })}</>
              )}
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:max-w-xs">
          <Label htmlFor="costing-basis">{t('splitBy')}</Label>
          <Select
            value={basis}
            onValueChange={(v) => setBasis(v as AllocationBasis)}
            disabled={costed || pending}
          >
            <SelectTrigger id="costing-basis">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALLOCATION_BASIS_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {tBasis(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{tBasis(`${basis}_hint`)}</p>
        </div>

        {allocation.fallbackReason && (
          <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                {allocation.fallbackReason.code === 'missingWeight'
                  ? t('fallbackMissingWeight', {
                      count: allocation.fallbackReason.missingCount,
                      basis:
                        allocation.fallbackReason.fallbackBasis === 'VALUE'
                          ? t('valueWord')
                          : t('unitsWord'),
                    })
                  : t('fallbackNoCost')}
              </p>
              {missingWeights.length > 0 && (
                <p className="text-muted-foreground">
                  {t('addWeightPrefix')}{' '}
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
                  {t('addWeightSuffix')}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('product')}</TableHead>
                <TableHead className="text-right">{t('qty')}</TableHead>
                <TableHead className="text-right">{t('weight')}</TableHead>
                <TableHead className="text-right">{t('share')}</TableHead>
                <TableHead className="text-right">{t('goodsPerUnit')}</TableHead>
                <TableHead className="text-right">{t('freightPerUnit')}</TableHead>
                <TableHead className="text-right">{t('landedPerUnit')}</TableHead>
                <TableHead className="text-right">{t('lineTotal')}</TableHead>
                {!costed && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={costed ? 8 : 9} className="py-10 text-center text-muted-foreground">
                    {t('nothingInShipment')}
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
                          <span className="sr-only">{t('removeProduct', { name: b.productName })}</span>
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
              <dt className="text-muted-foreground">{t('units')}</dt>
              <dd className="font-medium">{totalUnits}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('goods')}</dt>
              <dd className="font-medium">{formatUsd(totalGoods)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('freightBill')}</dt>
              <dd className="font-medium">{formatUsd(bill)}</dd>
              {localUsd > 0 && (
                <dd className="text-xs text-muted-foreground">
                  {t('inclLocal', { value: formatUsd(localUsd) })}
                </dd>
              )}
            </div>
            <div>
              <dt className="text-muted-foreground">{t('landedTotal')}</dt>
              <dd className="font-medium">{formatUsd(totalGoods + bill - allocation.residualUsd)}</dd>
            </div>
          </dl>

          {!costed && (
            <div className="flex gap-2">
              {estimatedUsd > 0 && (
                <Button variant="outline" onClick={onEstimate} disabled={pending}>
                  {t('applyEstimate', { value: formatUsd(estimatedUsd) })}
                </Button>
              )}
              <Button onClick={onCost} disabled={pending || bill <= 0 || batches.length === 0}>
                <Check className="size-4" />
                {pending ? t('applying') : t('applyAndReceive')}
              </Button>
            </div>
          )}
        </div>

        {allocation.residualUsd !== 0 && bill > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('residualNote', {
              value: formatUsd(Math.abs(allocation.residualUsd)),
              direction: allocation.residualUsd > 0 ? t('leftOver') : t('overAllocated'),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
