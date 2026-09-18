-- Stock already sitting in Full when it was loaded, with no Full box behind it.

-- AlterTable
ALTER TABLE "inventory_batches" ADD COLUMN "placedInFull" BOOLEAN NOT NULL DEFAULT false;
