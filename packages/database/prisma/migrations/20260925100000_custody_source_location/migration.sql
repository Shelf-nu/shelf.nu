-- Record which location a quantity-tracked asset's units come from.
--
-- "Custody"."locationId" is the manual placement an operator custody row
-- took its units from. NULL means the unplaced units, or a source that was
-- never recorded. "ConsumptionLog"."locationId" is the location a stock
-- movement left or arrived at. Both point at the location itself and are set
-- to NULL when the location is deleted, so the custody and the ledger rows
-- survive.
--
-- Order matters: add the columns, backfill them, then swap the unique index.
-- The new index only widens the old key, so the backfill cannot create a
-- duplicate either way.

-- AlterTable
ALTER TABLE "Custody" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "ConsumptionLog" ADD COLUMN     "locationId" TEXT;

-- CreateIndex
CREATE INDEX "Custody_locationId_idx" ON "Custody"("locationId");

-- CreateIndex
CREATE INDEX "ConsumptionLog_locationId_idx" ON "ConsumptionLog"("locationId");

-- AddForeignKey
ALTER TABLE "Custody" ADD CONSTRAINT "Custody_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionLog" ADD CONSTRAINT "ConsumptionLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill. Operator custody (kitCustodyId IS NULL) on a quantity-tracked
-- asset placed at exactly ONE manual location with no unplaced units takes
-- that location: the units can only have come from there. This is the same
-- source a new assignment on that pool records. Every other row keeps NULL:
--   - pools with no manual placement (NULL already means "unplaced"),
--   - pools at one location plus unplaced units (the units may have come
--     from either; a new assignment there records NULL too),
--   - pools placed at two or more locations (the source was never recorded),
--   - kit-inherited rows (their units follow the kit, never a placement),
--   - individual assets.
-- The last condition keeps "custody from a location <= units placed there"
-- true after the backfill: a pool whose operator custody exceeds its single
-- placement is left NULL rather than over-claiming that location.
UPDATE "Custody" AS c
SET "locationId" = single."locationId"
FROM (
  SELECT
    al."assetId",
    MIN(al."locationId") AS "locationId",
    SUM(al."quantity") AS "placed",
    MAX(COALESCE(a."quantity", 0)) AS "total"
  FROM "AssetLocation" AS al
  JOIN "Asset" AS a ON a."id" = al."assetId"
  WHERE al."assetKitId" IS NULL
    AND a."type" = 'QUANTITY_TRACKED'
  GROUP BY al."assetId"
  HAVING COUNT(*) = 1
) AS single
WHERE c."assetId" = single."assetId"
  AND c."kitCustodyId" IS NULL
  AND c."locationId" IS NULL
  AND single."placed" >= single."total"
  AND (
    SELECT COALESCE(SUM(op."quantity"), 0)
    FROM "Custody" AS op
    WHERE op."assetId" = single."assetId"
      AND op."kitCustodyId" IS NULL
  ) <= single."placed";

-- One operator custody row per (asset, holder, source location). NULLS NOT
-- DISTINCT makes the NULL source a key value like any other, so a holder has
-- at most one row of unplaced / unrecorded units per asset. Requires
-- Postgres 15+.
DROP INDEX IF EXISTS "Custody_operator_unique";

CREATE UNIQUE INDEX "Custody_operator_unique"
  ON "Custody" ("assetId", "teamMemberId", "locationId") NULLS NOT DISTINCT
  WHERE "kitCustodyId" IS NULL;

-- Deleting a location sets "Custody"."locationId" to NULL (the FK above). A
-- holder may already have a NULL-source row on the same asset, or hold units
-- from two locations deleted in one statement; setting both to NULL would
-- break "Custody_operator_unique" and make the delete fail. This trigger runs
-- first, for every path that deletes a location (the location pages, a
-- workspace or user deletion cascading into its locations): it folds each
-- custody row taken from the location into the holder's NULL-source row when
-- one exists, and clears the source on the rest itself, so the FK action
-- finds nothing left to update. Units never change; only where the custody
-- says they came from.
CREATE OR REPLACE FUNCTION custody_release_source_before_location_delete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "Custody" AS keep
  SET "quantity" = keep."quantity" + gone."quantity",
      "updatedAt" = now()
  FROM "Custody" AS gone
  WHERE gone."locationId" = OLD."id"
    AND gone."kitCustodyId" IS NULL
    AND keep."assetId" = gone."assetId"
    AND keep."teamMemberId" = gone."teamMemberId"
    AND keep."locationId" IS NULL
    AND keep."kitCustodyId" IS NULL;

  DELETE FROM "Custody" AS gone
  USING "Custody" AS keep
  WHERE gone."locationId" = OLD."id"
    AND gone."kitCustodyId" IS NULL
    AND keep."assetId" = gone."assetId"
    AND keep."teamMemberId" = gone."teamMemberId"
    AND keep."locationId" IS NULL
    AND keep."kitCustodyId" IS NULL;

  UPDATE "Custody"
  SET "locationId" = NULL,
      "updatedAt" = now()
  WHERE "locationId" = OLD."id";

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER custody_release_source_before_location_delete
  BEFORE DELETE ON "Location"
  FOR EACH ROW
  EXECUTE FUNCTION custody_release_source_before_location_delete();
