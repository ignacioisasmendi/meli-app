-- CreateEnum
CREATE TYPE "SaleSource" AS ENUM ('WEBHOOK', 'REPORT');

-- AlterTable
ALTER TABLE "sales" ADD COLUMN "source" "SaleSource" NOT NULL DEFAULT 'WEBHOOK';

-- CreateTable
CREATE TABLE "sales_reports" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3),
    "rowCount" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_report_rows" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "saleNumber" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "statusDetail" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPriceArs" DOUBLE PRECISION,
    "productRevenueArs" DOUBLE PRECISION NOT NULL,
    "feeArs" DOUBLE PRECISION NOT NULL,
    "taxArs" DOUBLE PRECISION NOT NULL,
    "shippingIncomeArs" DOUBLE PRECISION NOT NULL,
    "shippingCostArs" DOUBLE PRECISION NOT NULL,
    "otherChargesArs" DOUBLE PRECISION NOT NULL,
    "refundsArs" DOUBLE PRECISION NOT NULL,
    "totalArs" DOUBLE PRECISION NOT NULL,
    "mlItemId" TEXT,
    "title" TEXT,
    "variant" TEXT,
    "sku" TEXT,
    "buyerName" TEXT,
    "returnResult" TEXT,
    "appliedAt" TIMESTAMP(3),
    "applyNote" TEXT,

    CONSTRAINT "sales_report_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_reports_accountId_idx" ON "sales_reports"("accountId");

-- CreateIndex
CREATE INDEX "sales_report_rows_reportId_idx" ON "sales_report_rows"("reportId");

-- CreateIndex
CREATE INDEX "sales_report_rows_saleNumber_idx" ON "sales_report_rows"("saleNumber");

-- AddForeignKey
ALTER TABLE "sales_reports" ADD CONSTRAINT "sales_reports_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "mercadolibre_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_report_rows" ADD CONSTRAINT "sales_report_rows_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "sales_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
