-- Update enforce_asset_location_sum_within_total to exclude kit-driven rows.
--
-- Per the orthogonal-axes model documented in
-- `docs/proposals/quantitative-assets.md` (lines 783-794):
--
--   "Placement axes (Location, Kit, Custody, Booking) are orthogonal — an
--    asset can be at Location X AND in Alice's Custody AND part of Kit Y
--    simultaneously, each describing a different facet of the same physical
--    units. Each axis carries its own `sum ≤ Asset.quantity` invariant; the
--    axes don't subtract from each other."
--
-- The original trigger summed BOTH manual and kit-driven AssetLocation rows,
-- which conflated the Location and Kit axes: an asset fully placed manually
-- (sum = Asset.quantity) could not be added to any kit at all because the
-- kit-driven row would push the total over the cap.
--
-- The kit axis is already bounded by `enforce_asset_kit_sum_within_total`
-- (sum of `AssetKit.quantity` ≤ Asset.quantity). Kit-driven AssetLocation
-- rows mirror their AssetKit 1:1 (via the `AssetLocation_kit_unique`
-- partial index on `assetKitId`), so excluding them from the location-axis
-- sum is safe: their constraint is already enforced on the AssetKit table.
--
-- After this change, the manual AssetLocation sum is bounded independently:
--   SUM(AssetLocation.quantity WHERE assetKitId IS NULL) ≤ Asset.quantity
-- and the kit-driven sum is implicitly bounded by the AssetKit trigger.
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
  -- already keeps the count at 1; nothing to enforce here.
  IF asset_total IS NULL THEN
    RETURN NULL;
  END IF;

  -- Manual placements only — kit-driven rows are bounded by the AssetKit
  -- axis trigger (the kit slice's quantity ≤ Asset.quantity invariant).
  -- Conflating both axes broke the "add a fully-placed asset to a kit"
  -- flow, which is the canonical operation the orthogonal-axes design
  -- was meant to support.
  SELECT COALESCE(SUM(quantity), 0) INTO pivot_sum
    FROM "AssetLocation"
    WHERE "assetId" = asset_id
      AND "assetKitId" IS NULL;

  IF pivot_sum > asset_total THEN
    RAISE EXCEPTION 'AssetLocation total % exceeds Asset.quantity % for asset %',
      pivot_sum, asset_total, asset_id USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
