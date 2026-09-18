-- An AuditScan stored its descriptive facts BY REFERENCE: the asset's name and
-- whether it was expected lived in `Asset` / `AuditAsset`, both of which vanish
-- when the asset is deleted (Cascade on AuditAsset, SetNull on AuditScan.asset).
-- The scan row survived pointing at nothing, so a completed audit could show a
-- nameless row it could not even classify — while the session's denormalised
-- counters still claimed it. An audit is a historical record; these two facts
-- are now recorded by value so a row stays meaningful after the asset is gone.
--
-- Deliberately NOT backfilled. Both columns are nullable, so adding them is a
-- catalog-only change in Postgres: no table rewrite, no long lock, and nothing
-- for the Fly release_command to block on. Existing rows keep working because
-- readers prefer the live asset and only fall back to the snapshot; the rows
-- that would benefit from a backfill are precisely the ones whose asset is
-- already deleted, where there is nothing left to backfill FROM.
ALTER TABLE "AuditScan" ADD COLUMN "assetTitle" TEXT;
ALTER TABLE "AuditScan" ADD COLUMN "wasExpected" BOOLEAN;
