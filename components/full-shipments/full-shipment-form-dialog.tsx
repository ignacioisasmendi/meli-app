'use client'

import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  ReceivedStockPicker,
  fullQuantitiesValid,
  toFullLines,
  type FullQuantities,
} from '@/components/full-shipments/received-stock-picker'
import { createFullShipment, getReceivedStockForFull, updateFullShipment } from '@/actions/full-shipments'
import type { ReceivedProduct } from '@/lib/inventory/full-shipments'

interface Account {
  id: string
  nickname: string
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
  const [products, setProducts] = useState<ReceivedProduct[] | null>(null)
  const [quantities, setQuantities] = useState<FullQuantities>({})
  const editing = Boolean(fullShipment)
  const valid = editing || (products !== null && fullQuantitiesValid(products, quantities))

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next || editing) return
    setProducts(null)
    setQuantities({})
    getReceivedStockForFull()
      .then(setProducts)
      .catch(() => toast.error(t('couldNotLoadStock')))
  }

  function onSubmit(formData: FormData) {
    if (!editing) formData.set('lines', JSON.stringify(toFullLines(quantities)))
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
      <DialogContent className="sm:max-w-2xl">
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
              <div className="grid gap-2">
                <Label>{t('selectProducts')}</Label>
                <p className="text-xs text-muted-foreground">{t('receivedExplainer')}</p>
                <ReceivedStockPicker
                  products={products}
                  quantities={quantities}
                  onChange={setQuantities}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending || !accountId || !valid}>
              {isPending ? tCommon('saving') : editing ? tCommon('saveChanges') : t('createFullShipment')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
