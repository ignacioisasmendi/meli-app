-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('NEW', 'SHORTLISTED', 'REJECTED', 'IMPORTED');

-- CreateTable
CREATE TABLE "opportunity_candidates" (
    "id" TEXT NOT NULL,
    "asin" TEXT,
    "title" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT,
    "modelKey" TEXT NOT NULL,
    "amazonPriceUsd" DOUBLE PRECISION NOT NULL,
    "amazonTaxUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weightGrams" DOUBLE PRECISION NOT NULL,
    "mlPriceArs" DOUBLE PRECISION NOT NULL,
    "mlSoldQty" INTEGER,
    "mlPermalink" TEXT,
    "mlCategoryId" TEXT,
    "usdArsRate" DOUBLE PRECISION NOT NULL,
    "freightUsdPerKg" DOUBLE PRECISION NOT NULL,
    "freightUsd" DOUBLE PRECISION NOT NULL,
    "landedUsd" DOUBLE PRECISION NOT NULL,
    "mlFeeRate" DOUBLE PRECISION NOT NULL,
    "mlFeeArs" DOUBLE PRECISION NOT NULL,
    "mlShippingCostArs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netProfitUsd" DOUBLE PRECISION NOT NULL,
    "roiPct" DOUBLE PRECISION NOT NULL,
    "breakEvenMlArs" DOUBLE PRECISION NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'NEW',
    "rejectedReason" TEXT,
    "productId" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_observations" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "amazonPriceUsd" DOUBLE PRECISION NOT NULL,
    "mlPriceArs" DOUBLE PRECISION NOT NULL,
    "netProfitUsd" DOUBLE PRECISION NOT NULL,
    "roiPct" DOUBLE PRECISION NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_candidates_modelKey_key" ON "opportunity_candidates"("modelKey");

-- CreateIndex
CREATE INDEX "opportunity_candidates_status_idx" ON "opportunity_candidates"("status");

-- CreateIndex
CREATE INDEX "opportunity_candidates_roiPct_idx" ON "opportunity_candidates"("roiPct");

-- CreateIndex
CREATE INDEX "opportunity_candidates_scannedAt_idx" ON "opportunity_candidates"("scannedAt");

-- CreateIndex
CREATE INDEX "price_observations_candidateId_observedAt_idx" ON "price_observations"("candidateId", "observedAt");

-- AddForeignKey
ALTER TABLE "opportunity_candidates" ADD CONSTRAINT "opportunity_candidates_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "opportunity_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
