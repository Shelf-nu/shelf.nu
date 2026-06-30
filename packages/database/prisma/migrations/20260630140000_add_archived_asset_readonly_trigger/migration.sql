-- Archived assets are read-only (issue #382): a database-level backstop.
--
-- The app already blocks user-facing mutations of archived assets via
-- `assertAssetsAreNotArchived` (~/utils/org-validation.server). This trigger is
-- defense-in-depth: it rejects writes to an archived Asset row no matter which
-- code path issues them (a direct service caller that forgets the guard, a raw
-- SQL update, a future endpoint), so the freeze holds even where the app guard
-- does not run.
--
-- Scoped, NOT blanket. Only fires for already-archived rows, and still allows
-- the writes that legitimately touch archived assets:
--   * Reinstate: clearing `archivedAt` back to NULL (the only way out).
--   * Signed-URL refresh: `refreshExpiredAssetImages` re-signs `mainImage` /
--     `thumbnailImage` / `mainImageExpiration` on the read path; a blanket
--     reject would stop archived assets' images from rendering.
--   * FK cascade: `preferredBarcodeId` is `ON DELETE SET NULL`, so deleting a
--     barcode nulls it on referencing assets, archived or not.
--   * Prisma's `@updatedAt` bump that rides along with the above.
-- DELETE is intentionally not guarded, so permanently deleting an archived
-- asset still works.
--
-- Follows the repo's hand-written-SQL-in-an-empty-migration trigger convention
-- (see enforce_individual_asset_single_location in
-- 20260519143054_add_asset_location_pivot).

CREATE OR REPLACE FUNCTION enforce_archived_asset_readonly()
RETURNS TRIGGER AS $$
DECLARE
  -- A copy of NEW with the system-writable columns reset to their OLD values,
  -- so a leftover difference vs OLD means a *protected* (user-facing) column
  -- changed.
  normalized "Asset";
BEGIN
  -- Only archived rows are frozen.
  IF OLD."archivedAt" IS NULL THEN
    RETURN NEW;
  END IF;

  -- Reinstating (clearing archivedAt) is always allowed.
  IF NEW."archivedAt" IS NULL THEN
    RETURN NEW;
  END IF;

  -- Row is, and stays, archived: permit only the system-managed columns to
  -- change; reject any other column change as a frozen-asset mutation.
  normalized := NEW;
  normalized."mainImage"           := OLD."mainImage";
  normalized."thumbnailImage"      := OLD."thumbnailImage";
  normalized."mainImageExpiration" := OLD."mainImageExpiration";
  normalized."preferredBarcodeId"  := OLD."preferredBarcodeId";
  normalized."updatedAt"           := OLD."updatedAt";

  IF normalized IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION
      'Asset % is archived and read-only. Reinstate it before making changes.',
      OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_archived_readonly
  BEFORE UPDATE ON "Asset"
  FOR EACH ROW EXECUTE FUNCTION enforce_archived_asset_readonly();
