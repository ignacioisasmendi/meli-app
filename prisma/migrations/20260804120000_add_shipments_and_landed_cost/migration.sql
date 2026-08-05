-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('OPEN', 'IN_TRANSIT', 'ARRIVED', 'COSTED');

-- CreateEnum
CREATE TYPE "AllocationBasis" AS ENUM ('WEIGHT', 'VALUE', 'UNITS');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "weightLb" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "inventory_batches" ADD COLUMN     "freightIsEstimate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "freightUnitCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "goodsUnitCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "shipmentId" TEXT;

-- Backfill: existing batches carry no import freight, so their whole recorded
-- cost is goods cost. Without this they would read as $0 goods + $0 freight and
-- a later re-costing would wipe out their real cost.
UPDATE "inventory_batches" SET "goodsUnitCostUsd" = "unitCostUsd";

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "courier" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'OPEN',
    "basis" "AllocationBasis" NOT NULL DEFAULT 'WEIGHT',
    "estimatedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freightUsd" DOUBLE PRECISION,
    "customsUsd" DOUBLE PRECISION,
    "otherUsd" DOUBLE PRECISION,
    "notes" TEXT,
    "departedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "costedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipments_code_key" ON "shipments"("code");

-- CreateIndex
CREATE INDEX "shipments_status_idx" ON "shipments"("status");

-- CreateIndex
CREATE INDEX "inventory_batches_shipmentId_idx" ON "inventory_batches"("shipmentId");

-- AddForeignKey
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
