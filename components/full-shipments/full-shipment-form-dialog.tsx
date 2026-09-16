'use client'

import { useMemo, useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { createFullShipment, getShipmentsEligibleForFull, updateFullShipment } from '@/actions/full-shipments'
import { aggregateFullShipmentLines } from '@/lib/inventory/full-shipment-lines'

interface Account {
  id: string
  nickname: string
}

interface EligibleShipment {
  id: string
  code: string
  courier: string | null
  batches: Array<{ quantity: number; product: { id: string; name: string; sku: string } }>
}

interface FullShipmentFormDialogProps {
  accounts: Account[]
  fullShipment?: {
    id: string
    accountId: string
    mlInboundId: string
    sentAt: Date
    notes: string | null
  }
  trigger?: React.ReactNode
}

export function FullShipmentFormDialog({
  accounts,
  fullShipment,
  trigger,
}: FullShipmentFormDialogProps) {
  const t = useTranslations('FullShipmentForm')
  const tCommon = useTranslations('Common')
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [accountId, setAccountId] = useState(fullShipment?.accountId ?? accounts[0]?.id ?? '')
  const [shipments, setShipments] = useState<EligibleShipment[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const editing = Boolean(fullShipment)

  const summary = useMemo(
    () => aggregateFullShipmentLines(shipments?.filter((s) => selected.has(s.id)) ?? []),
    [shipments, selected]
  )

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next || editing) return
    setShipments(null)
    setSelected(new Set())
    getShipmentsEligibleForFull()
      .then(setShipments)
      .catch(() => toast.error(t('couldNotLoadShipments')))
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onSubmit(formData: FormData) {
    for (const id of selected) formData.append('shipmentIds', id)
    startTransition(async () => {
      try {
        const result = editing
          ? await updateFullShipment(fullShipment!.id, formData)
          : await createFullShipment(formData)
        if (result.ok) {
          toast.success(editing ? t('updated') : t('created'))
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            {t('newFullShipment')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? t('editFullShipment') : t('newFullShipment')}</DialogTitle>
            <DialogDescription>{t('explainer')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="accountId">{t('account')}</Label>
              <input type="hidden" name="accountId" value={accountId} />
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="accountId">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nickname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="mlInboundId">{t('mlInboundId')}</Label>
              <Input
                id="mlInboundId"
                name="mlInboundId"
                defaultValue={fullShipment?.mlInboundId}
                placeholder="0001"
                required
              />
              <p className="text-xs text-muted-foreground">{t('mlInboundIdHint')}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="sentAt">{t('sentAt')}</Label>
              <Input
                id="sentAt"
                name="sentAt"
                type="date"
                defaultValue={
                  (fullShipment?.sentAt ?? new Date()).toISOString().slice(0, 10)
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">{t('notes')}</Label>
              <Textarea
                id="notes"
                name="notes"
                defaultValue={fullShipment?.notes ?? ''}
                placeholder={t('notesPlaceholder')}
                rows={2}
              />
            </div>

            {!editing && (
              <>
                <div className="grid gap-2">
                  <Label>{t('selectShipments')}</Label>
                  <p className="text-xs text-muted-foreground">{t('eligibleExplainer')}</p>
                  <ScrollArea className="max-h-48 rounded-md border pr-4">
                    {shipments === null && (
                      <p className="py-6 text-center text-sm text-muted-foreground">{t('loading')}</p>
                    )}
                    {shipments?.length === 0 && (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        {t('nothingEligible')}
                      </p>
                    )}
                    <div className="space-y-1 p-1">
                      {shipments?.map((s) => {
                        const units = s.batches.reduce((n, b) => n + b.quantity, 0)
                        return (
                          <label
                            key={s.id}
                            className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted"
                          >
                            <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{s.code}</span>
                              <span className="block text-xs text-muted-foreground">
                                {s.courier ?? '—'} · {t('unitsCount', { count: units })}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </ScrollArea>
                </div>

                <div className="grid gap-2">
                  <Label>{t('summary')}</Label>
                  {summary.length === 0 ? (
                    <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                      {t('noSummaryYet')}
                    </p>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('product')}</TableHead>
                            <TableHead>{t('sku')}</TableHead>
                            <TableHead className="text-right">{t('units')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {summary.map((line) => (
                            <TableRow key={line.productId}>
                              <TableCell className="font-medium">{line.productName}</TableCell>
                              <TableCell className="text-muted-foreground">{line.sku}</TableCell>
                              <TableCell className="text-right">{line.quantity}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending || !accountId}>
              {isPending ? tCommon('saving') : editing ? tCommon('saveChanges') : t('createFullShipment')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
