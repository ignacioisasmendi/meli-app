import { PurchaseStatus } from '@prisma/client'

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  PURCHASED: 'Purchased',
  IN_USA: 'In USA',
  IN_TRANSIT: 'In transit',
  CUSTOMS: 'Customs',
  WAREHOUSE: 'Warehouse',
  AVAILABLE: 'Available',
}

export const PURCHASE_STATUS_OPTIONS = (
  Object.values(PurchaseStatus) as PurchaseStatus[]
).map((value) => ({ value, label: PURCHASE_STATUS_LABELS[value] }))
