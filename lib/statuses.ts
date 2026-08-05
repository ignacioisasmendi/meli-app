import { AllocationBasis, PurchaseStatus, ShipmentStatus } from '@prisma/client'

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

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  OPEN: 'Open',
  IN_TRANSIT: 'In transit',
  ARRIVED: 'Arrived',
  COSTED: 'Costed',
}

/** COSTED is omitted — it is reached by entering the bill, not by picking it. */
export const SHIPMENT_STATUS_OPTIONS = (
  [ShipmentStatus.OPEN, ShipmentStatus.IN_TRANSIT, ShipmentStatus.ARRIVED] as ShipmentStatus[]
).map((value) => ({ value, label: SHIPMENT_STATUS_LABELS[value] }))

export const ALLOCATION_BASIS_LABELS: Record<AllocationBasis, string> = {
  WEIGHT: 'By weight',
  VALUE: 'By value',
  UNITS: 'Per unit',
}

export const ALLOCATION_BASIS_HINTS: Record<AllocationBasis, string> = {
  WEIGHT: 'Split by each product’s share of the box weight — how couriers bill.',
  VALUE: 'Split by each line’s share of the goods cost.',
  UNITS: 'Same freight on every unit, regardless of size.',
}

export const ALLOCATION_BASIS_OPTIONS = (
  Object.values(AllocationBasis) as AllocationBasis[]
).map((value) => ({ value, label: ALLOCATION_BASIS_LABELS[value] }))
