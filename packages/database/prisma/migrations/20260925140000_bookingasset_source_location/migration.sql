-- `BookingAsset.sourceLocationId`: the location a quantity-tracked booking
-- slice's units left from.
--
-- A pool can be placed at several locations. Until now a booking check-out
-- recorded no location, so a check-in that reported units consumed, lost or
-- damaged could not say which location lost them: the placement sum ended up
-- above the new total and the server only logged "the source location is
-- ambiguous". Recording the source when the slice first goes out lets
-- check-in take the units off the right placement.
--
-- Cascade on Location delete: `ON DELETE SET NULL`. The slice keeps its place
-- on the booking and only loses the source, which check-in then treats like
-- a slice with no source (the unplaced units absorb the drop).
--
-- No Prisma `@relation` accessor: same TS2321 recursion constraint as
-- `assetKitId`, `sourceKitId` and `ConsumptionLog.bookingAssetId`. See the
-- comment on the column in schema.prisma.
--
-- Additive and nullable, no backfill: slices already out were never asked,
-- so NULL is the honest value for them.

ALTER TABLE "BookingAsset" ADD COLUMN "sourceLocationId" TEXT;

ALTER TABLE "BookingAsset"
  ADD CONSTRAINT "BookingAsset_sourceLocationId_fkey"
  FOREIGN KEY ("sourceLocationId") REFERENCES "Location"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "BookingAsset_sourceLocationId_idx" ON "BookingAsset"("sourceLocationId");
