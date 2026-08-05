-- Switch product weights from pounds to grams.
--
-- Written as a RENAME rather than the drop-and-add Prisma would generate, so
-- any weight already on file survives and gets converted instead of silently
-- becoming NULL. Freight allocation is proportional, so the unit never changed
-- the split — only what you type in and read back.
ALTER TABLE "products" RENAME COLUMN "weightLb" TO "weightGrams";

UPDATE "products"
SET "weightGrams" = ROUND(("weightGrams" * 453.59237)::numeric, 2)
WHERE "weightGrams" IS NOT NULL;
