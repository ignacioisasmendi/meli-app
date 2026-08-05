-- Returns & cancellations.
--
-- Three pieces:
--   1. Sales carry a status plus reversal columns, so a cancelled/returned sale
--      keeps its gross figures and reports net them out arithmetically.
--   2. sale_batch_consumptions records which batches a sale ate, so returned
--      units go back onto the batch they came from at the cost they left at.
--   3. The webhook dedupe key gains `sentAt` — see below, this was a bug.

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'RETURN_PENDING', 'RETURNED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'RETURN';

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "status" "SaleStatus" NOT NULL DEFAULT 'CONFIRMED',
ADD COLUMN     "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "restockedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundedArs" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "reversedProfitUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "mlClaimId" TEXT,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "sales_status_idx" ON "sales"("status");

-- CreateIndex
CREATE INDEX "sales_mlClaimId_idx" ON "sales"("mlClaimId");

-- CreateTable
CREATE TABLE "sale_batch_consumptions" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "batchId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitCostUsd" DOUBLE PRECISION NOT NULL,
    "restoredQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_batch_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_batch_consumptions_saleId_idx" ON "sale_batch_consumptions"("saleId");

-- CreateIndex
CREATE INDEX "sale_batch_consumptions_batchId_idx" ON "sale_batch_consumptions"("batchId");

-- AddForeignKey
ALTER TABLE "sale_batch_consumptions" ADD CONSTRAINT "sale_batch_consumptions_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_batch_consumptions" ADD CONSTRAINT "sale_batch_consumptions_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "inventory_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sales that predate this migration have no consumption rows, so a reversal
-- can't know which batch to credit. `reverseSale` falls back to the product's
-- average cost for those, which is the same fallback `applySale` already uses
-- when batches run short — no backfill is possible or needed.

-- AlterTable: webhook dedupe key.
--
-- The old unique on (topic, resource) meant the FIRST notification for an order
-- claimed the row forever; every later notification on the same resource — most
-- importantly the one saying the order was cancelled — matched it and was
-- dropped as a duplicate. Adding the notification's own `sent` timestamp keeps
-- ML's delivery retries deduped (same `sent`) while letting genuine state
-- changes through (different `sent`).
-- The key is one non-null text column rather than a compound unique including
-- `sentAt`, because Postgres treats NULLs as distinct: a nullable member would
-- silently stop deduping for any payload that omits `sent`.
ALTER TABLE "webhook_events" ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "dedupeKey" TEXT;

-- Backfill existing rows. They predate `sent` capture, and the old unique on
-- (topic, resource) guarantees this is collision-free.
UPDATE "webhook_events" SET "dedupeKey" = "topic" || '|' || "resource" || '|none';

ALTER TABLE "webhook_events" ALTER COLUMN "dedupeKey" SET NOT NULL;

-- DropIndex
DROP INDEX "webhook_events_topic_resource_key";

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_dedupeKey_key" ON "webhook_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "webhook_events_topic_resource_idx" ON "webhook_events"("topic", "resource");
