-- CreateTable
CREATE TABLE "PartialBookingCheckout" (
    "id" TEXT NOT NULL,
    "assetIds" TEXT[],
    "checkoutCount" INTEGER NOT NULL,
    "checkoutTimestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookingId" TEXT NOT NULL,
    "checkedOutById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartialBookingCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartialBookingCheckout_bookingId_idx" ON "PartialBookingCheckout"("bookingId");

-- CreateIndex
CREATE INDEX "PartialBookingCheckout_checkedOutById_idx" ON "PartialBookingCheckout"("checkedOutById");

-- CreateIndex
CREATE INDEX "PartialBookingCheckout_checkoutTimestamp_idx" ON "PartialBookingCheckout"("checkoutTimestamp");

-- CreateIndex
CREATE INDEX "PartialBookingCheckout_bookingId_checkoutTimestamp_idx" ON "PartialBookingCheckout"("bookingId", "checkoutTimestamp");

-- AddForeignKey
ALTER TABLE "PartialBookingCheckout" ADD CONSTRAINT "PartialBookingCheckout_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartialBookingCheckout" ADD CONSTRAINT "PartialBookingCheckout_checkedOutById_fkey" FOREIGN KEY ("checkedOutById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable RLS (mirrors PartialBookingCheckin; relies on service-role bypass, no policies)
ALTER TABLE "PartialBookingCheckout" ENABLE row level security;
