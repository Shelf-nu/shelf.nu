-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "activeSchedulerReference" TEXT,
ALTER COLUMN "name" SET NOT NULL;
