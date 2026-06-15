-- AlterTable
ALTER TABLE "Booking"
  ADD COLUMN "archivedWithoutCheckin" BOOLEAN NOT NULL DEFAULT false;
