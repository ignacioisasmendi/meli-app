-- A Full box now takes stock per product, so the link moves from the shipment
-- to the batch.

-- AlterTable
ALTER TABLE "inventory_batches" ADD COLUMN "fullShipmentId" TEXT;

-- Backfill: every batch of a shipment already consolidated into a Full box
-- inherits that box.
UPDATE "inventory_batches" AS b
SET "fullShipmentId" = s."fullShipmentId"
FROM "shipments" AS s
WHERE b."shipmentId" = s."id" AND s."fullShipmentId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "inventory_batches_fullShipmentId_idx" ON "inventory_batches"("fullShipmentId");

-- AddForeignKey
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_fullShipmentId_fkey" FOREIGN KEY ("fullShipmentId") REFERENCES "full_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_fullShipmentId_fkey";

-- DropIndex
DROP INDEX "shipments_fullShipmentId_idx";

-- AlterTable
ALTER TABLE "shipments" DROP COLUMN "fullShipmentId";
