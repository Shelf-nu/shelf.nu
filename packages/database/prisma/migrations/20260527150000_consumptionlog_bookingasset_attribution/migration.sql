-- Per-row attribution for ConsumptionLog entries.
--
-- Polish-6 introduced multi-row BookingAsset slices: a single
-- (booking, asset) pair can have one standalone row and one or more
-- kit-driven rows in the same booking. Up to now ConsumptionLog was
-- keyed only by (bookingId, assetId), so check-in dispositions
-- couldn't be attributed to a specific slice — the loader and
-- partial-checkin drawer treated all slices as one bucket, hiding
-- outstanding units on parallel slices.
--
-- This migration adds a nullable FK so each log row can point at the
-- specific BookingAsset it was disposed against. Legacy rows stay
-- NULL and are handled by a greedy-fill fallback in the readers
-- (kit-driven slices attribute first, then standalone).
--
-- FK uses ON DELETE SET NULL so removing a BookingAsset row preserves
-- history (the log isn't lost, it just loses its per-row link). The
-- accompanying check-in floor guard lives in the service layer, not
-- here.

ALTER TABLE "ConsumptionLog"
  ADD COLUMN "bookingAssetId" TEXT;

ALTER TABLE "ConsumptionLog"
  ADD CONSTRAINT "ConsumptionLog_bookingAssetId_fkey"
  FOREIGN KEY ("bookingAssetId") REFERENCES "BookingAsset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ConsumptionLog_bookingAssetId_idx"
  ON "ConsumptionLog" ("bookingAssetId");
