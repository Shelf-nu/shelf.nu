-- CreateIndex
CREATE INDEX "BookingAsset_assetId_idx" ON "BookingAsset"("assetId");

-- CreateIndex
CREATE INDEX "ConsumptionLog_bookingId_idx" ON "ConsumptionLog"("bookingId");

-- CreateIndex
CREATE INDEX "ConsumptionLog_custodianId_idx" ON "ConsumptionLog"("custodianId");
