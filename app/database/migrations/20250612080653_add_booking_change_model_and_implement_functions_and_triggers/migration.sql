-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'ASSET_ADDED', 'ASSET_REMOVED', 'TAG_ADDED', 'TAG_REMOVED');

-- CreateTable
CREATE TABLE "BookingChange" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "changeType" "ChangeType" NOT NULL,
    "changedBy" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "bookingBefore" JSONB,
    "bookingAfter" JSONB NOT NULL,
    "changedFields" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingChange_bookingId_createdAt_idx" ON "BookingChange"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingChange_changeType_createdAt_idx" ON "BookingChange"("changeType", "createdAt");

-- CreateIndex
CREATE INDEX "BookingChange_changedBy_createdAt_idx" ON "BookingChange"("changedBy", "createdAt");

-- AddForeignKey
ALTER TABLE "BookingChange" ADD CONSTRAINT "BookingChange_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EnableRowLevelSecurity
ALTER TABLE "BookingChange" ENABLE row level security;