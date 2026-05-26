-- Enforce the ownership invariant on Asset.preferredBarcodeId at the
-- database layer: the referenced Barcode must belong to the SAME Asset and
-- the SAME organization. Application-layer pre-flight in `updateAsset`
-- already enforces this, but a DB trigger prevents future write paths
-- (admin tools, bulk imports, data-fix scripts) from silently violating it.
--
-- Deferrable + initially deferred:
--   Transactions that create a Barcode and set Asset.preferredBarcodeId in
--   either order need the check to fire at COMMIT, not at each statement.
--   Without DEFERRABLE, the order of `INSERT Barcode` / `UPDATE Asset` would
--   matter and would break Prisma's `update + connect` patterns.
--
-- Pre-flight self-check at the top: if existing data already violates
-- the invariant (it shouldn't — the column was just introduced in
-- `20260522103000_add_preferred_barcode_and_extend_qr_id_display_pref`),
-- the migration aborts so the violation can be investigated rather than
-- left as silent drift.

-- 1. Validate any pre-existing violations BEFORE creating the trigger.
DO $$
DECLARE
  violation_count integer;
BEGIN
  SELECT COUNT(*) INTO violation_count
  FROM "Asset" a
  WHERE a."preferredBarcodeId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "Barcode" b
      WHERE b.id = a."preferredBarcodeId"
        AND b."assetId" = a.id
        AND b."organizationId" = a."organizationId"
    );

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Cannot install preferredBarcodeId integrity trigger: % existing Asset row(s) reference a Barcode that does not belong to them. Investigate the offending rows before re-running this migration.',
      violation_count;
  END IF;
END $$;

-- 2. Trigger function: check ownership when preferredBarcodeId is non-null.
CREATE OR REPLACE FUNCTION assert_preferred_barcode_belongs_to_asset()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."preferredBarcodeId" IS NOT NULL THEN
    PERFORM 1
    FROM "Barcode"
    WHERE id = NEW."preferredBarcodeId"
      AND "assetId" = NEW.id
      AND "organizationId" = NEW."organizationId";

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        MESSAGE = format(
          'Asset.preferredBarcodeId (%s) must reference a Barcode owned by Asset %s in organization %s',
          NEW."preferredBarcodeId", NEW.id, NEW."organizationId"
        ),
        ERRCODE = '23514'; -- check_violation
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- 3. Install as a deferrable constraint trigger. Fires AFTER INSERT/UPDATE
--    of `preferredBarcodeId`. Deferred to COMMIT so multi-statement
--    transactions can insert Barcode + Asset in either order.
DROP TRIGGER IF EXISTS asset_preferred_barcode_belongs_to_asset
  ON "Asset";

CREATE CONSTRAINT TRIGGER asset_preferred_barcode_belongs_to_asset
  AFTER INSERT OR UPDATE OF "preferredBarcodeId" ON "Asset"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_preferred_barcode_belongs_to_asset();
