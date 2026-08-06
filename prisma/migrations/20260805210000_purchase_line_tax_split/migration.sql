-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "taxUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "shippingUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill: until now a line's extras were only knowable as the gap between
-- what it was billed and its goods, with tax and shipping blended together.
-- Split that gap by the order's own tax:shipping ratio, giving shipping the
-- remainder so the two parts still add back up to the gap exactly.
--
-- Orders with no recorded extras (everything imported before they were stored)
-- keep the 0 defaults rather than a made-up split.
UPDATE "purchases" p
SET "taxUsd" = ROUND(
      (
        (p."totalCostUsd" - p."unitPriceUsd" * p."quantity")
          * o."taxUsd" / (o."taxUsd" + o."shippingUsd")
      )::numeric,
      2
    ),
    "shippingUsd" = ROUND((p."totalCostUsd" - p."unitPriceUsd" * p."quantity")::numeric, 2)
      - ROUND(
          (
            (p."totalCostUsd" - p."unitPriceUsd" * p."quantity")
              * o."taxUsd" / (o."taxUsd" + o."shippingUsd")
          )::numeric,
          2
        )
FROM "purchase_orders" o
WHERE p."orderId" = o."id"
  AND o."taxUsd" + o."shippingUsd" > 0
  AND p."totalCostUsd" - p."unitPriceUsd" * p."quantity" > 0;
