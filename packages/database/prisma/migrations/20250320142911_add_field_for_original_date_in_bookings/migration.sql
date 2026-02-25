-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "originalFrom" TIMESTAMPTZ(3),
ADD COLUMN     "originalTo" TIMESTAMPTZ(3);
