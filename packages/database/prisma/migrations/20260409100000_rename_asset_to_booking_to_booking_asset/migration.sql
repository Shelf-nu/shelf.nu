-- Phase 3a: Replace the implicit M2M (_AssetToBooking) with the explicit
-- BookingAsset pivot table. Uses a rename strategy — no data is copied.
--
-- The Phase 1 migration created an empty BookingAsset table that coexisted
-- with the implicit M2M. We drop that empty shell and rename the real
-- data-bearing _AssetToBooking table into its place.

-- 1. Drop the empty Phase 1 BookingAsset table (has no data)
DROP TABLE "BookingAsset";

-- 2. Rename the implicit M2M table and its columns
ALTER TABLE "_AssetToBooking" RENAME TO "BookingAsset";
ALTER TABLE "BookingAsset" RENAME COLUMN "A" TO "assetId";
ALTER TABLE "BookingAsset" RENAME COLUMN "B" TO "bookingId";

-- 3. Add quantity column (default 1 for all existing rows)
ALTER TABLE "BookingAsset" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;

-- 4. Replace composite PK with a text ID primary key
ALTER TABLE "BookingAsset" DROP CONSTRAINT "_AssetToBooking_AB_pkey";
ALTER TABLE "BookingAsset" ADD COLUMN "id" TEXT;
UPDATE "BookingAsset" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;
ALTER TABLE "BookingAsset" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "BookingAsset" ADD CONSTRAINT "BookingAsset_pkey" PRIMARY KEY ("id");

-- 5. Add unique constraint on (bookingId, assetId) to replace the old PK
ALTER TABLE "BookingAsset"
  ADD CONSTRAINT "BookingAsset_bookingId_assetId_key"
  UNIQUE ("bookingId", "assetId");

-- 6. Rename existing B index, add assetId index
ALTER INDEX "_AssetToBooking_B_index" RENAME TO "BookingAsset_bookingId_idx";
CREATE INDEX "BookingAsset_assetId_idx" ON "BookingAsset" ("assetId");

-- 7. Rename foreign key constraints to match Prisma conventions
ALTER TABLE "BookingAsset" RENAME CONSTRAINT "_AssetToBooking_A_fkey" TO "BookingAsset_assetId_fkey";
ALTER TABLE "BookingAsset" RENAME CONSTRAINT "_AssetToBooking_B_fkey" TO "BookingAsset_bookingId_fkey";

-- RLS was already enabled on _AssetToBooking and carries over with the rename.
