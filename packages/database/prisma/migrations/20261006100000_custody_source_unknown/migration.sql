-- Tell "taken from the unplaced units" apart from "source never recorded".
--
-- Both are stored as "Custody"."locationId" NULL. "sourceUnknown" is true for
-- the second: the assignment named no source and the pool had more than one
-- place the units could have come from. Unknown units count against no
-- location and never against the unplaced units.
--
-- Order matters: add the column, backfill it, then widen the unique index.
-- Before the backfill each holder has at most one NULL-source row per asset,
-- and the backfill only flips a flag on it, so the wider index cannot meet a
-- duplicate.

-- AlterTable
ALTER TABLE "Custody" ADD COLUMN "sourceUnknown" BOOLEAN NOT NULL DEFAULT false;

-- Backfill. An operator custody row on a quantity-tracked asset with no
-- recorded source is unknown when the pool has at least one manual placement:
-- its units may have come from that placement or from the unplaced units.
-- A pool with no manual placement has only the unplaced units, so its NULL
-- rows stay false. Pools at one location with nothing unplaced already had
-- their source filled in by 20260925100000_custody_source_location.
UPDATE "Custody" AS c
SET "sourceUnknown" = true
WHERE c."kitCustodyId" IS NULL
  AND c."locationId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "AssetLocation" AS al
    JOIN "Asset" AS a ON a."id" = al."assetId"
    WHERE al."assetId" = c."assetId"
      AND al."assetKitId" IS NULL
      AND a."type" = 'QUANTITY_TRACKED'
  );

-- One operator custody row per (asset, holder, source), where a source is a
-- location, the unplaced units, or unknown. Requires Postgres 15+.
DROP INDEX IF EXISTS "Custody_operator_unique";

CREATE UNIQUE INDEX "Custody_operator_unique"
  ON "Custody" ("assetId", "teamMemberId", "locationId", "sourceUnknown")
  NULLS NOT DISTINCT
  WHERE "kitCustodyId" IS NULL;

-- Deleting a location makes the custody taken from it unplaced: its rows fold
-- into the holder's unplaced row (NULL source, not unknown) when one exists,
-- and otherwise just lose their source. Rows whose source is unknown are
-- never the fold target.
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
    AND keep."sourceUnknown" = false
    AND keep."kitCustodyId" IS NULL;

  DELETE FROM "Custody" AS gone
  USING "Custody" AS keep
  WHERE gone."locationId" = OLD."id"
    AND gone."kitCustodyId" IS NULL
    AND keep."assetId" = gone."assetId"
    AND keep."teamMemberId" = gone."teamMemberId"
    AND keep."locationId" IS NULL
    AND keep."sourceUnknown" = false
    AND keep."kitCustodyId" IS NULL;

  UPDATE "Custody"
  SET "locationId" = NULL,
      "updatedAt" = now()
  WHERE "locationId" = OLD."id";

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
