-- CreateEnum
CREATE TYPE "ImportDraftStatus" AS ENUM ('PENDING', 'IMPORTED', 'DISCARDED');

-- CreateTable
CREATE TABLE "import_drafts" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "orderNumber" TEXT,
    "sourceUrl" TEXT,
    "status" "ImportDraftStatus" NOT NULL DEFAULT 'PENDING',
    "order" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "pageItems" JSONB,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_drafts_status_idx" ON "import_drafts"("status");

-- CreateIndex
CREATE INDEX "import_drafts_supplier_orderNumber_idx" ON "import_drafts"("supplier", "orderNumber");
