-- CreateEnum
CREATE TYPE "FullShipmentStatus" AS ENUM ('SENT', 'RECEIVED');

-- AlterTable
ALTER TABLE "ml_listings" ADD COLUMN     "inventoryId" TEXT;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "fullShipmentId" TEXT;

-- CreateTable
CREATE TABLE "full_shipments" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "mlInboundId" TEXT NOT NULL,
    "status" "FullShipmentStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "full_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "full_shipments_status_idx" ON "full_shipments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "full_shipments_accountId_mlInboundId_key" ON "full_shipments"("accountId", "mlInboundId");

-- CreateIndex
CREATE INDEX "shipments_fullShipmentId_idx" ON "shipments"("fullShipmentId");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_fullShipmentId_fkey" FOREIGN KEY ("fullShipmentId") REFERENCES "full_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "full_shipments" ADD CONSTRAINT "full_shipments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "mercadolibre_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
