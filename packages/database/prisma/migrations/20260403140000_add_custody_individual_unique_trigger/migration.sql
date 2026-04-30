-- Enforce single custodian for INDIVIDUAL assets at the database level.
-- PostgreSQL doesn't support subqueries in partial index predicates,
-- so we use a trigger instead (PRD Decision #8).

CREATE OR REPLACE FUNCTION enforce_individual_asset_single_custody()
RETURNS TRIGGER AS $$
BEGIN
  -- Only enforce for INDIVIDUAL assets
  IF EXISTS (
    SELECT 1 FROM "Asset"
    WHERE "Asset"."id" = NEW."assetId"
    AND "Asset"."type" = 'INDIVIDUAL'
  ) THEN
    -- Check if there is already a custody record for this asset
    IF EXISTS (
      SELECT 1 FROM "Custody"
      WHERE "assetId" = NEW."assetId"
      AND "id" != COALESCE(NEW."id", '')
    ) THEN
      RAISE EXCEPTION 'Individual assets can only have one custody record at a time (asset: %)', NEW."assetId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER custody_individual_asset_check
  BEFORE INSERT OR UPDATE ON "Custody"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_individual_asset_single_custody();
