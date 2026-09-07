-- Fills the AuditScan snapshot columns for scans recorded before they existed.
--
-- The columns were added nullable and unbackfilled, which leaves every scan
-- taken before that deploy depending on its Asset and AuditAsset rows to stay
-- alive — the exact dependency the snapshot exists to remove. Deleting the
-- asset cascades the AuditAsset away and SetNulls the scan's asset, and a row
-- with no snapshot has nothing left to name or classify it.
--
-- These rows CAN be filled: the ones worth protecting are the ones whose asset
-- is still present, and they are the overwhelming majority. Only scans already
-- orphaned are unrecoverable, and the `IS NULL` guards leave them untouched
-- rather than writing a wrong value over them.
--
-- Idempotent by construction: every statement is guarded on the column still
-- being NULL, so re-running changes nothing, and a scan recorded after the
-- deploy already carries its own snapshot and is skipped.
--
-- Every join is index-backed — AuditScan has indexes on "assetId" and
-- "auditAssetId", AuditAsset is unique on ("auditSessionId", "assetId").

-- The title as it stands now. A rename between the scan and this backfill is
-- not a loss: readers prefer the live asset anyway, so the snapshot only ever
-- has to answer for the row once the asset is gone.
UPDATE "AuditScan" s
SET "assetTitle" = a."title"
FROM "Asset" a
WHERE s."assetId" = a."id"
  AND s."assetTitle" IS NULL;

-- Expectedness, taken from the AuditAsset row the scan is linked to.
UPDATE "AuditScan" s
SET "wasExpected" = aa."expected"
FROM "AuditAsset" aa
WHERE s."auditAssetId" = aa."id"
  AND s."wasExpected" IS NULL;

-- Scans predating the auditAssetId link carry no relation, so they resolve the
-- same way the read path does: by (auditSessionId, assetId), which AuditAsset
-- is unique on and which is therefore the authority on whether the asset
-- belongs to the audit.
UPDATE "AuditScan" s
SET "wasExpected" = aa."expected"
FROM "AuditAsset" aa
WHERE s."auditAssetId" IS NULL
  AND s."auditSessionId" = aa."auditSessionId"
  AND s."assetId" = aa."assetId"
  AND s."wasExpected" IS NULL;
