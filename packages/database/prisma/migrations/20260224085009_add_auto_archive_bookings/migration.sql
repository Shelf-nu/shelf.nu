-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "autoArchivedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "BookingSettings" ADD COLUMN     "autoArchiveBookings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoArchiveDays" INTEGER NOT NULL DEFAULT 2;
