-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'RESERVED', 'ONGOING', 'OVERDUE', 'COMPLETE', 'ARCHIVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Asset"
ADD COLUMN "availableToBook" BOOLEAN DEFAULT true;

UPDATE "Asset"
SET "availableToBook" = true;

ALTER TABLE "Asset"
ALTER COLUMN "availableToBook" SET NOT NULL;

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
    "creatorId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "from" TIMESTAMPTZ(3),
    "to" TIMESTAMPTZ(3),

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AssetToBooking" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_AssetToBooking_AB_unique" ON "_AssetToBooking"("A", "B");

-- CreateIndex
CREATE INDEX "_AssetToBooking_B_index" ON "_AssetToBooking"("B");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssetToBooking" ADD CONSTRAINT "_AssetToBooking_A_fkey" FOREIGN KEY ("A") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssetToBooking" ADD CONSTRAINT "_AssetToBooking_B_fkey" FOREIGN KEY ("B") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
