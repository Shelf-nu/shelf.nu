-- AlterTable
ALTER TABLE "BookingSettings"
  ADD COLUMN "autoArchiveExpiredReservations" BOOLEAN NOT NULL DEFAULT false;
