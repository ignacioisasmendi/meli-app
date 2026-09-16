'use client'

import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { AllocationBasis } from '@prisma/client'
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
import { ALLOCATION_BASIS_VALUES } from '@/lib/statuses'
import { createShipment, updateShipment } from '@/actions/shipments'

interface ShipmentFormDialogProps {
  shipment?: {
    id: string
    code: string
    courier: string | null
    basis: AllocationBasis
    estimatedUsd: number
    notes: string | null
  }
  trigger?: React.ReactNode
}

export function ShipmentFormDialog({ shipment, trigger }: ShipmentFormDialogProps) {
  const t = useTranslations('ShipmentForm')
  const tBasis = useTranslations('AllocationBasis')
  const tCommon = useTranslations('Common')
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [basis, setBasis] = useState<AllocationBasis>(shipment?.basis ?? AllocationBasis.WEIGHT)
  const editing = Boolean(shipment)

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        const result = editing
          ? await updateShipment(shipment!.id, formData)
          : await createShipment(formData)
        if (result.ok) {
          toast.success(editing ? t('shipmentUpdated') : t('shipmentCreated'))
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            {t('newShipment')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? t('editShipment') : t('newShipment')}</DialogTitle>
            <DialogDescription>{t('shipmentExplainer')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="code">{t('code')}</Label>
                <Input
                  id="code"
                  name="code"
                  defaultValue={shipment?.code}
                  placeholder="ENVIO-2026-03"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="courier">{t('courier')}</Label>
                <Input
                  id="courier"
                  name="courier"
                  defaultValue={shipment?.courier ?? ''}
                  placeholder="Aerobox, TiendaMía…"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="basis">{t('splitFreight')}</Label>
              <input type="hidden" name="basis" value={basis} />
              <Select value={basis} onValueChange={(v) => setBasis(v as AllocationBasis)}>
                <SelectTrigger id="basis">
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

            <div className="grid gap-2">
              <Label htmlFor="estimatedUsd">{t('estimatedFreightUsd')}</Label>
              <Input
                id="estimatedUsd"
                name="estimatedUsd"
                type="number"
                step="0.01"
                min={0}
                defaultValue={shipment?.estimatedUsd || ''}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">{t('estimatedFreightHint')}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">{t('notes')}</Label>
              <Textarea
                id="notes"
                name="notes"
                defaultValue={shipment?.notes ?? ''}
                placeholder={t('notesPlaceholder')}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? tCommon('saving') : editing ? tCommon('saveChanges') : t('createShipment')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
