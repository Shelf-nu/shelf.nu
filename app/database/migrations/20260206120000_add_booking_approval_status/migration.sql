-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'APPROVED';
ALTER TYPE "BookingStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "rejectionReason" TEXT;
