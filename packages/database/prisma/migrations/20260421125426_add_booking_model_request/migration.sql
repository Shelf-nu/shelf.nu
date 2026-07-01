-- DropIndex
DROP INDEX "BookingAsset_bookingId_idx";

-- CreateTable
CREATE TABLE "BookingModelRequest" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "assetModelId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingModelRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingModelRequest_assetModelId_idx" ON "BookingModelRequest"("assetModelId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingModelRequest_bookingId_assetModelId_key" ON "BookingModelRequest"("bookingId", "assetModelId");

-- AddForeignKey
ALTER TABLE "BookingModelRequest" ADD CONSTRAINT "BookingModelRequest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingModelRequest" ADD CONSTRAINT "BookingModelRequest_assetModelId_fkey" FOREIGN KEY ("assetModelId") REFERENCES "AssetModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
