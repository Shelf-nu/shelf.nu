-- DropIndex
DROP INDEX "BookingChange_bookingId_createdAt_idx";

-- DropIndex
DROP INDEX "BookingChange_changeType_createdAt_idx";

-- DropIndex
DROP INDEX "BookingChange_changedBy_createdAt_idx";

-- AlterTable
ALTER TABLE "BookingChange" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "BookingChange_bookingId_organizationId_idx" ON "BookingChange"("bookingId", "organizationId");

-- CreateIndex
CREATE INDEX "BookingChange_organizationId_createdAt_idx" ON "BookingChange"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingChange_organizationId_changeType_idx" ON "BookingChange"("organizationId", "changeType");

-- CreateIndex
CREATE INDEX "BookingChange_organizationId_bookingId_createdAt_idx" ON "BookingChange"("organizationId", "bookingId", "createdAt");

-- AddForeignKey
ALTER TABLE "BookingChange" ADD CONSTRAINT "BookingChange_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
