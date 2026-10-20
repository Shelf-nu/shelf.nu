-- Booking approval: approval is data on the booking, not a status.
-- All additive: nullable columns + a default-false org toggle, safe to run
-- while the previous app version is live (no drops, no rewrites).

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "approvedAt" TIMESTAMPTZ(3),
ADD COLUMN     "approvedById" TEXT;

-- AlterTable
ALTER TABLE "BookingSettings" ADD COLUMN     "requireBookingApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Booking_approvedById_idx" ON "Booking"("approvedById");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
