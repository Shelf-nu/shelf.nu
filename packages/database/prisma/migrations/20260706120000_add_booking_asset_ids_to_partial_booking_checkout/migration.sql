-- AlterTable
ALTER TABLE "PartialBookingCheckout"
    ADD COLUMN "bookingAssetIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
