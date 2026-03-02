/*
  Warnings:

  - Made the column `from` on table `Booking` required. This step will fail if there are existing NULL values in that column.
  - Made the column `to` on table `Booking` required. This step will fail if there are existing NULL values in that column.

*/
-- Data migration: Set default dates for bookings with NULL from/to values
-- This ensures the migration succeeds for existing databases with draft bookings
UPDATE "Booking"
SET 
  "from" = COALESCE("from", NOW()),
  "to" = COALESCE("to", NOW() + INTERVAL '10 minutes')
WHERE "from" IS NULL OR "to" IS NULL;

-- AlterTable
ALTER TABLE "Booking" ALTER COLUMN "from" SET NOT NULL,
ALTER COLUMN "to" SET NOT NULL;
