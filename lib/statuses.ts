import { AllocationBasis, PurchaseStatus, ShipmentStatus } from '@prisma/client'

export const PURCHASE_STATUS_VALUES = Object.values(PurchaseStatus) as PurchaseStatus[]

/**
 * Where a batch loaded by hand sits: a batch status, or FULL — on hand inside a
 * Full warehouse without a Full box behind it (`placedInFull`).
 */
export const BATCH_LOCATION_VALUES = [...PURCHASE_STATUS_VALUES, 'FULL'] as const
export type BatchLocation = (typeof BATCH_LOCATION_VALUES)[number]

/** COSTED is omitted — it is reached by entering the bill, not by picking it. */
export const SHIPMENT_STATUS_VALUES = [
  ShipmentStatus.OPEN,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.ARRIVED,
] as ShipmentStatus[]

export const ALLOCATION_BASIS_VALUES = Object.values(AllocationBasis) as AllocationBasis[]
