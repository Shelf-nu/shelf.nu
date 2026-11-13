-- Booking source locations: where a quantity-tracked booking slice's units
-- are planned from, out from and released from, and which slice and source
-- each disposition log's units count against.
--
-- "BookingAsset"."sourceAllocation" says how a slice is attributed. Every
-- existing slice gets LEGACY, which keeps today's behaviour: no source rows,
-- no shares. Groups convert lazily, in the application, never here.
--
-- "BookingAssetSource": one row per source of a converted slice.
-- "BookingDispositionShare": quantity-level attribution of a disposition log
-- to a slice and a source row. Several rows may carry the same
-- (log, slice, source) tuple, so it deliberately has no uniqueness on it.
--
-- No Prisma `@relation` on either table (TS2321 recursion constraint, same as
-- "BookingAsset"."assetKitId"): the foreign keys below exist only here and
-- are registered in PROTECTED_FOREIGN_KEYS in src/protected-indexes.ts, and
-- the NULLS NOT DISTINCT unique key, which Prisma cannot express, in
-- PROTECTED_INDEXES. The plain indexes are declared in schema.prisma. Every
-- foreign key column has an index led by that column, so a cascade or
-- restrict lookup from a deleted parent never scans the tables.
--
-- Additive only: new enums, two new BookingAsset columns (the NOT NULL one
-- has a constant default, so adding it does not rewrite the table), two new
-- empty tables. No backfill.

-- CreateEnum
CREATE TYPE "BookingSourceAllocation" AS ENUM ('LEGACY', 'KIT', 'AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "BookingSourceKind" AS ENUM ('LOCATION', 'UNPLACED', 'UNKNOWN', 'UNASSIGNED', 'KIT');

-- CreateEnum
CREATE TYPE "DispositionShareOrigin" AS ENUM ('SEEDED', 'RECORDED', 'OVERFLOW');

-- AlterTable
ALTER TABLE "BookingAsset"
  ADD COLUMN "sourceAllocation" "BookingSourceAllocation" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "sourcesConvertedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "BookingAssetSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookingAssetId" TEXT NOT NULL,
    "kind" "BookingSourceKind" NOT NULL,
    "locationId" TEXT,
    "quantity" INTEGER NOT NULL,
    "outQuantity" INTEGER NOT NULL DEFAULT 0,
    "releasedQuantity" INTEGER NOT NULL DEFAULT 0,
    "dispatchedTotal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingAssetSource_pkey" PRIMARY KEY ("id"),
    -- Counters are never negative; out and released units are part of the plan.
    CONSTRAINT "BookingAssetSource_counts_check" CHECK (
      "quantity" >= 0
      AND "outQuantity" >= 0
      AND "releasedQuantity" >= 0
      AND "dispatchedTotal" >= 0
      AND "outQuantity" + "releasedQuantity" <= "quantity"
    ),
    -- A location is named if and only if the row is a LOCATION row.
    CONSTRAINT "BookingAssetSource_location_kind_check" CHECK (
      ("locationId" IS NOT NULL) = ("kind" = 'LOCATION')
    )
);

-- CreateTable
CREATE TABLE "BookingDispositionShare" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "consumptionLogId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "bookingAssetId" TEXT,
    "bookingAssetSourceId" TEXT,
    "quantity" INTEGER NOT NULL,
    "origin" "DispositionShareOrigin" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingDispositionShare_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BookingDispositionShare_quantity_check" CHECK ("quantity" > 0)
);

-- One row per (slice, kind, location). NULLS NOT DISTINCT (Postgres 15+)
-- makes the location-less kinds unique per slice too: at most one UNPLACED,
-- UNKNOWN, UNASSIGNED and KIT row each. Leads with "bookingAssetId", so it
-- also serves as that foreign key's index. Prisma cannot express it, so it
-- lives only here and is protected.
CREATE UNIQUE INDEX "BookingAssetSource_slice_kind_location_key"
  ON "BookingAssetSource"("bookingAssetId", "kind", "locationId") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "BookingAssetSource_locationId_idx" ON "BookingAssetSource"("locationId");

-- CreateIndex
CREATE INDEX "BookingAssetSource_organizationId_locationId_idx" ON "BookingAssetSource"("organizationId", "locationId");

-- CreateIndex
CREATE INDEX "BookingDispositionShare_consumptionLogId_idx" ON "BookingDispositionShare"("consumptionLogId");

-- CreateIndex
CREATE INDEX "BookingDispositionShare_bookingAssetSourceId_idx" ON "BookingDispositionShare"("bookingAssetSourceId");

-- CreateIndex
CREATE INDEX "BookingDispositionShare_bookingAssetId_idx" ON "BookingDispositionShare"("bookingAssetId");

-- CreateIndex
CREATE INDEX "BookingDispositionShare_bookingId_assetId_idx" ON "BookingDispositionShare"("bookingId", "assetId");

-- CreateIndex
CREATE INDEX "BookingDispositionShare_assetId_idx" ON "BookingDispositionShare"("assetId");

-- CreateIndex
CREATE INDEX "BookingDispositionShare_organizationId_idx" ON "BookingDispositionShare"("organizationId");

-- Removing a slice removes its source rows.
ALTER TABLE "BookingAssetSource"
  ADD CONSTRAINT "BookingAssetSource_bookingAssetId_fkey"
  FOREIGN KEY ("bookingAssetId") REFERENCES "BookingAsset"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT: deleting a location first moves every source row off it; a row
-- the service missed makes the delete fail loudly instead of losing units.
ALTER TABLE "BookingAssetSource"
  ADD CONSTRAINT "BookingAssetSource_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BookingAssetSource"
  ADD CONSTRAINT "BookingAssetSource_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingDispositionShare"
  ADD CONSTRAINT "BookingDispositionShare_consumptionLogId_fkey"
  FOREIGN KEY ("consumptionLogId") REFERENCES "ConsumptionLog"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingDispositionShare"
  ADD CONSTRAINT "BookingDispositionShare_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingDispositionShare"
  ADD CONSTRAINT "BookingDispositionShare_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL: a removed slice leaves its shares orphaned, so its logs stay
-- fully shared and the surviving slices' numbers do not change.
ALTER TABLE "BookingDispositionShare"
  ADD CONSTRAINT "BookingDispositionShare_bookingAssetId_fkey"
  FOREIGN KEY ("bookingAssetId") REFERENCES "BookingAsset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BookingDispositionShare"
  ADD CONSTRAINT "BookingDispositionShare_bookingAssetSourceId_fkey"
  FOREIGN KEY ("bookingAssetSourceId") REFERENCES "BookingAssetSource"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BookingDispositionShare"
  ADD CONSTRAINT "BookingDispositionShare_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS like every public table, with no policies; the app connects as a
-- role that bypasses it.
ALTER TABLE "BookingAssetSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookingDispositionShare" ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges grant new public tables to its API roles.
-- Revoke them. The roles do not exist on plain Postgres, so each revoke runs
-- only when its role exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON "BookingAssetSource", "BookingDispositionShare" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON "BookingAssetSource", "BookingDispositionShare" FROM authenticated';
  END IF;
END
$$;
