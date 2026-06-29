-- Phase 4a-Polish-2: unlock multi-kit allocation for QUANTITY_TRACKED assets.
--
-- Phase 4a shipped `AssetKit` with `@@unique([assetId])`, which preserved the
-- old `Asset.kitId` "one kit per asset" invariant during the structural
-- rewrite. This migration replaces that global constraint with two
-- AssetType-aware DB triggers:
--
--   1. enforce_individual_asset_single_kit (BEFORE INSERT/UPDATE)
--      Caps INDIVIDUAL assets at one AssetKit row each, matching the
--      pre-pivot behaviour. QUANTITY_TRACKED assets are now free to belong
--      to multiple kits with distinct per-kit quantities.
--
--   2. enforce_asset_kit_sum_within_total (DEFERRABLE INITIALLY DEFERRED
--      CONSTRAINT TRIGGER)
--      Sum of AssetKit.quantity per asset must not exceed Asset.quantity.
--      DEFERRED so a "move N units from Kit A to Kit B" two-row update
--      inside a single transaction is valid mid-flight and only checked
--      at COMMIT.
--
-- It also backfills existing pivot rows so `AssetKit.quantity` carries
-- meaningful data immediately after the constraint relaxes — qty-tracked
-- assets that today "belong to a kit" semantically own the kit's full
-- pool, so their pivot rows get `quantity = Asset.quantity`. INDIVIDUAL
-- rows stay at 1.

-- DropIndex
-- Prisma created the @@unique([assetId]) as a standalone unique INDEX,
-- not a table constraint, so `ALTER TABLE DROP CONSTRAINT` is a no-op
-- here. Drop the index directly.
DROP INDEX IF EXISTS "AssetKit_assetId_key";

-- 1. INDIVIDUAL assets still cap at one AssetKit row per asset.
--    Mirrors Phase 2's `custody_individual_asset_check` trigger shape.
CREATE OR REPLACE FUNCTION enforce_individual_asset_single_kit()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT type FROM "Asset" WHERE id = NEW."assetId") = 'INDIVIDUAL'
     AND (
       SELECT COUNT(*) FROM "AssetKit"
       WHERE "assetId" = NEW."assetId" AND id <> NEW.id
     ) > 0
  THEN
    RAISE EXCEPTION 'INDIVIDUAL asset % already linked to a kit',
      NEW."assetId" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_kit_individual_single_row
  BEFORE INSERT OR UPDATE ON "AssetKit"
  FOR EACH ROW EXECUTE FUNCTION enforce_individual_asset_single_kit();

-- 2. sum(AssetKit.quantity) per asset must be <= Asset.quantity.
--    DEFERRABLE INITIALLY DEFERRED so the picker's "move N from Kit A to
--    Kit B" two-row update (decrement A, increment B) is valid mid-flight
--    and only re-checked at COMMIT.
CREATE OR REPLACE FUNCTION enforce_asset_kit_sum_within_total()
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
    FROM "AssetKit" WHERE "assetId" = asset_id;

  IF pivot_sum > asset_total THEN
    RAISE EXCEPTION 'AssetKit total % exceeds Asset.quantity % for asset %',
      pivot_sum, asset_total, asset_id USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER asset_kit_sum_within_total
  AFTER INSERT OR UPDATE OR DELETE ON "AssetKit"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_asset_kit_sum_within_total();

-- 3. Backfill: QUANTITY_TRACKED pivot rows currently have quantity = 1
--    (the Phase 4a pin). Semantically the kit owns the full pool today,
--    so promote to Asset.quantity. INDIVIDUAL rows stay at 1.
--
--    Correctness: pre-migration there's at most one AssetKit row per
--    asset (the @@unique we just dropped held until this statement),
--    so sum(AssetKit.quantity) per asset = quantity of that single
--    row after the UPDATE = Asset.quantity. The DEFERRED constraint
--    trigger re-checks at COMMIT and passes.
UPDATE "AssetKit" ak
SET quantity = a.quantity
FROM "Asset" a
WHERE ak."assetId" = a.id
  AND a.type = 'QUANTITY_TRACKED'
  AND a.quantity IS NOT NULL
  AND ak.quantity = 1;
