-- Sale number: existing sales start with their order id as the sale number;
-- scripts/backfill-sale-net.ts swaps in the pack id where there is one.
ALTER TABLE "sales" ADD COLUMN "saleNumber" TEXT;
UPDATE "sales" SET "saleNumber" = "mlOrderId";
ALTER TABLE "sales" ALTER COLUMN "saleNumber" SET NOT NULL;

-- Payout breakdown. Existing rows get the best figure they had until
-- scripts/backfill-sale-net.ts reads the real one from Mercado Pago.
ALTER TABLE "sales" ADD COLUMN "taxArs" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "sales" ADD COLUMN "netReceivedArs" DOUBLE PRECISION NOT NULL DEFAULT 0;
UPDATE "sales" SET "netReceivedArs" = "salePriceArs" - "feeArs" - "shippingArs";

-- CreateIndex
CREATE INDEX "sales_saleNumber_idx" ON "sales"("saleNumber");
