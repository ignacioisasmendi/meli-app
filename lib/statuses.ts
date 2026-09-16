import { AllocationBasis, PurchaseStatus, ShipmentStatus } from '@prisma/client'

export const PURCHASE_STATUS_VALUES = Object.values(PurchaseStatus) as PurchaseStatus[]

/** COSTED is omitted — it is reached by entering the bill, not by picking it. */
export const SHIPMENT_STATUS_VALUES = [
  ShipmentStatus.OPEN,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.ARRIVED,
] as ShipmentStatus[]

export const ALLOCATION_BASIS_VALUES = Object.values(AllocationBasis) as AllocationBasis[]
