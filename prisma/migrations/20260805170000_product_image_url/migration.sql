-- Identification thumbnail for a product, backfilled from the linked Mercado
-- Libre listing's first picture. Nullable: products that were never listed on
-- ML (Amazon imports, drafts) simply have none.
ALTER TABLE "products" ADD COLUMN "imageUrl" TEXT;
