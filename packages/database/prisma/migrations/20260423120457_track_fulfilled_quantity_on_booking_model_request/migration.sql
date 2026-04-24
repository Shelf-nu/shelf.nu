-- AlterTable
ALTER TABLE "BookingModelRequest" ADD COLUMN     "fulfilledAt" TIMESTAMP(3),
ADD COLUMN     "fulfilledQuantity" INTEGER NOT NULL DEFAULT 0;
