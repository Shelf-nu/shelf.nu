-- AlterTable
ALTER TABLE "PartialBookingCheckout"
    ADD COLUMN "quantities" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
