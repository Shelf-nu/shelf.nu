-- `BookingAsset.sourceKitId` — durable kit provenance for booking slices
--
-- `BookingAsset.assetKitId` points at the AssetKit MEMBERSHIP row and is
-- `ON DELETE SET NULL`. Removing an asset from a kit therefore demotes every
-- existing booking's kit-driven slice to a standalone slice, which destroys
-- the fact that the slice ever came from a kit. Two user-visible bugs follow:
-- duplicating such a booking copies the demoted row in as a loose asset, and
-- `computeBookingKitDrift` can never report a removal (its snapshot only
-- reads rows that are STILL kit-driven).
--
-- This column records the owning `Kit` directly, so the provenance outlives
-- the membership row.
--
-- Cascade semantics on Kit delete: `ON DELETE SET NULL`. Deleting a kit
-- degrades its slices to loose assets on existing bookings — precisely the
-- behaviour that already exists today, so nothing regresses. Restricting kit
-- deletion because a booking once referenced the kit would be far worse.
--
-- No Prisma `@relation` accessor: same TS2321 recursion constraint that
-- applies to `assetKitId` and `ConsumptionLog.bookingAssetId`. See the paired
-- comments in schema.prisma on `BookingAsset.sourceKitId` and `Kit`.

-- 1. Add the nullable column. Constraint added separately so the column
--    exists before the FK references it (for clarity).
ALTER TABLE "BookingAsset" ADD COLUMN "sourceKitId" TEXT;

ALTER TABLE "BookingAsset"
  ADD CONSTRAINT "BookingAsset_sourceKitId_fkey"
  FOREIGN KEY ("sourceKitId") REFERENCES "Kit"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "BookingAsset_sourceKitId_idx" ON "BookingAsset"("sourceKitId");

-- 2. Backfill — exact, not heuristic. Every row that is CURRENTLY kit-driven
--    resolves to exactly one kit through its live AssetKit membership. This
--    is the identical join the booking UI already runs to group slices under
--    kits, so after this backfill every existing booking resolves to the same
--    kit it displays today: the migration is behaviour-neutral by
--    construction.
--
--    Rows detached BEFORE this migration are unrecoverable (the membership
--    row is gone) and correctly stay NULL — they already render as loose
--    assets, so they keep doing so.
UPDATE "BookingAsset" ba
SET "sourceKitId" = ak."kitId"
FROM "AssetKit" ak
WHERE ba."assetKitId" = ak."id";
