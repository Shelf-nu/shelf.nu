-- CreateTable
CREATE TABLE "BookingConflictAttempt" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "attemptedById" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "attemptType" TEXT NOT NULL,
    "conflictedAssetIds" TEXT[],
    "conflictedAssetNames" TEXT NOT NULL,
    "attemptedFrom" TIMESTAMPTZ(3) NOT NULL,
    "attemptedTo" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingConflictAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingConflictAttempt_bookingId_idx" ON "BookingConflictAttempt"("bookingId");

-- CreateIndex
CREATE INDEX "BookingConflictAttempt_attemptedById_idx" ON "BookingConflictAttempt"("attemptedById");

-- CreateIndex
CREATE INDEX "BookingConflictAttempt_organizationId_idx" ON "BookingConflictAttempt"("organizationId");

-- CreateIndex
CREATE INDEX "BookingConflictAttempt_createdAt_idx" ON "BookingConflictAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "BookingConflictAttempt_attemptType_idx" ON "BookingConflictAttempt"("attemptType");

-- AddForeignKey
ALTER TABLE "BookingConflictAttempt" ADD CONSTRAINT "BookingConflictAttempt_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingConflictAttempt" ADD CONSTRAINT "BookingConflictAttempt_attemptedById_fkey" FOREIGN KEY ("attemptedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingConflictAttempt" ADD CONSTRAINT "BookingConflictAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
