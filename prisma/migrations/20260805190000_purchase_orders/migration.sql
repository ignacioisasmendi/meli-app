-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "taxUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_orders_purchasedAt_idx" ON "purchase_orders"("purchasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_supplier_orderNumber_key" ON "purchase_orders"("supplier", "orderNumber");

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "unitPriceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "purchases_orderId_idx" ON "purchases"("orderId");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: the pre-tax unit price was never recorded, so the landed unit cost
-- is the closest truth we have for existing rows. Older lines therefore show a
-- tax & shipping share of zero rather than a made-up split.
UPDATE "purchases" SET "unitPriceUsd" = "unitCostUsd";

-- Backfill: imports used to encode the order number into `supplier` as
-- "Amazon · 113-2009210-6657853". Promote every distinct pair to a real order.
INSERT INTO "purchase_orders" ("id", "orderNumber", "supplier", "purchasedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       split_part("supplier", ' · ', 2),
       split_part("supplier", ' · ', 1),
       MIN("purchasedAt"),
       MIN("createdAt"),
       NOW()
FROM "purchases"
WHERE "supplier" LIKE '% · %'
GROUP BY split_part("supplier", ' · ', 1), split_part("supplier", ' · ', 2);

-- ...then link the lines to it and leave `supplier` holding just the supplier.
UPDATE "purchases" p
SET "orderId" = o."id",
    "supplier" = o."supplier"
FROM "purchase_orders" o
WHERE p."supplier" = o."supplier" || ' · ' || o."orderNumber";
