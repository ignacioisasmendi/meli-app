-- CreateTable
CREATE TABLE "product_aliases" (
    "id" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_aliases_productId_idx" ON "product_aliases"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_aliases_supplier_externalId_key" ON "product_aliases"("supplier", "externalId");

-- AddForeignKey
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

