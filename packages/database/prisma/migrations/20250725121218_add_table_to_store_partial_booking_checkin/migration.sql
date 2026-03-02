-- CreateTable
CREATE TABLE "PartialBookingCheckin" (
    "id" TEXT NOT NULL,
    "assetIds" TEXT[],
    "checkinCount" INTEGER NOT NULL,
    "checkinTimestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookingId" TEXT NOT NULL,
    "checkedInById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartialBookingCheckin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartialBookingCheckin_bookingId_idx" ON "PartialBookingCheckin"("bookingId");

-- CreateIndex
CREATE INDEX "PartialBookingCheckin_checkedInById_idx" ON "PartialBookingCheckin"("checkedInById");

-- CreateIndex
CREATE INDEX "PartialBookingCheckin_checkinTimestamp_idx" ON "PartialBookingCheckin"("checkinTimestamp");

-- CreateIndex
CREATE INDEX "PartialBookingCheckin_bookingId_checkinTimestamp_idx" ON "PartialBookingCheckin"("bookingId", "checkinTimestamp");

-- AddForeignKey
ALTER TABLE "PartialBookingCheckin" ADD CONSTRAINT "PartialBookingCheckin_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartialBookingCheckin" ADD CONSTRAINT "PartialBookingCheckin_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "PartialBookingCheckin" ENABLE row level security;