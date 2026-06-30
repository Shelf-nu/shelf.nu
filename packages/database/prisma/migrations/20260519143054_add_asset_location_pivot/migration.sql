-- Phase 4b — Replace Asset.locationId 1:1 FK with the AssetLocation
-- pivot, AND ship the qty-allocation triggers in the same migration.
--
-- Unlike Phase 4a (which split the structural pivot from the triggers
-- across two migrations to de-risk a first-of-kind pattern), Location
-- ships the final shape directly: there is no separate "Location
-- polish" release planned and re-sweeping ~108 files twice would be
-- wasteful. So no intermediate @@unique([assetId]) — the INDIVIDUAL
-- single-location cap is enforced by a trigger from day one.
--
-- Migration shape: introduce -> backfill -> triggers -> drop, all in
-- one transaction-scoped migration so no half-pivoted state is
-- observable to app code.
--
-- Cascade-semantics flag for PR description: old Asset.locationId was
-- nullable with Prisma default SET NULL on Location delete. New
-- AssetLocation.locationId is ON DELETE CASCADE — deleting a location
-- cascade-deletes the pivot rows; the assets themselves stay (only the
-- placement link is removed, asset becomes "unplaced"). End-state
-- observably equivalent.

-- 1. Create the AssetLocation pivot table.
CREATE TABLE "AssetLocation" (
  "id"             TEXT NOT NULL,
  "assetId"        TEXT NOT NULL,
  "locationId"     TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "quantity"       INTEGER NOT NULL DEFAULT 1,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetLocation_pkey" PRIMARY KEY ("id")
);

-- No "AssetLocation_assetId_key" single-row unique (the 4a AssetKit
-- had one until 4a-Polish-2 dropped it). The composite below still
-- prevents the same asset being placed twice at the same location.
CREATE UNIQUE INDEX "AssetLocation_assetId_locationId_key" ON "AssetLocation"("assetId", "locationId");
CREATE INDEX        "AssetLocation_locationId_idx"          ON "AssetLocation"("locationId");
CREATE INDEX        "AssetLocation_organizationId_idx"      ON "AssetLocation"("organizationId");
CREATE INDEX        "AssetLocation_assetId_idx"             ON "AssetLocation"("assetId");

ALTER TABLE "AssetLocation"
  ADD CONSTRAINT "AssetLocation_assetId_fkey"
    FOREIGN KEY ("assetId")        REFERENCES "Asset"("id")        ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssetLocation_locationId_fkey"
    FOREIGN KEY ("locationId")     REFERENCES "Location"("id")     ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssetLocation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Backfill — one row per asset currently placed at a location.
--    One shot (no 4a-style "1 then promote" two-step): a qty-tracked
--    asset that has a location semantically owns its full pool there;
--    INDIVIDUAL rows stay at 1. The DEFERRED sum trigger re-checks at
--    COMMIT and passes (one row per asset pre-migration, so
--    sum(AssetLocation.quantity) = that row's quantity <= Asset.quantity).
INSERT INTO "AssetLocation" ("id", "assetId", "locationId", "organizationId", "quantity", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  a."id",
  a."locationId",
  a."organizationId",
  CASE
    WHEN a."type" = 'QUANTITY_TRACKED' AND a."quantity" IS NOT NULL
      THEN a."quantity"
    ELSE 1
  END,
  now(),
  now()
FROM "Asset" a
WHERE a."locationId" IS NOT NULL;

-- 3. INDIVIDUAL assets cap at one AssetLocation row per asset.
--    Mirrors `enforce_individual_asset_single_kit` (Phase 4a-Polish-2).
CREATE OR REPLACE FUNCTION enforce_individual_asset_single_location()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT type FROM "Asset" WHERE id = NEW."assetId") = 'INDIVIDUAL'
     AND (
       SELECT COUNT(*) FROM "AssetLocation"
       WHERE "assetId" = NEW."assetId" AND id <> NEW.id
     ) > 0
  THEN
    RAISE EXCEPTION 'INDIVIDUAL asset % already placed at a location',
      NEW."assetId" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_location_individual_single_row
  BEFORE INSERT OR UPDATE ON "AssetLocation"
  FOR EACH ROW EXECUTE FUNCTION enforce_individual_asset_single_location();

-- 4. sum(AssetLocation.quantity) per asset must be <= Asset.quantity.
--    DEFERRABLE INITIALLY DEFERRED so a "move N units from Location A
--    to Location B" two-row tx (decrement A, increment B) is valid
--    mid-flight and only re-checked at COMMIT. Mirrors
--    `enforce_asset_kit_sum_within_total`.
CREATE OR REPLACE FUNCTION enforce_asset_location_sum_within_total()
RETURNS TRIGGER AS $$
DECLARE
  asset_total INT;
  pivot_sum   INT;
  asset_id    TEXT;
BEGIN
  asset_id := COALESCE(NEW."assetId", OLD."assetId");
  SELECT quantity INTO asset_total FROM "Asset" WHERE id = asset_id;

  -- INDIVIDUAL assets have asset_total = NULL. The single-row trigger
  -- above already keeps the count at 1; nothing to enforce here.
  IF asset_total IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO pivot_sum
    FROM "AssetLocation" WHERE "assetId" = asset_id;

  IF pivot_sum > asset_total THEN
    RAISE EXCEPTION 'AssetLocation total % exceeds Asset.quantity % for asset %',
      pivot_sum, asset_total, asset_id USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER asset_location_sum_within_total
  AFTER INSERT OR UPDATE OR DELETE ON "AssetLocation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_asset_location_sum_within_total();

-- 5. Drop the legacy column + its index + FK.
DROP INDEX IF EXISTS "Asset_locationId_organizationId_idx";
ALTER TABLE "Asset" DROP CONSTRAINT IF EXISTS "Asset_locationId_fkey";
ALTER TABLE "Asset" DROP COLUMN "locationId";

-- 6. Enable RLS to match the AssetKit / Kit / KitCustody pattern
--    (Supabase default-deny; all access goes through the Prisma client
--    carrying the service-role JWT, so no explicit policy needed).
ALTER TABLE "AssetLocation" ENABLE row level security;
