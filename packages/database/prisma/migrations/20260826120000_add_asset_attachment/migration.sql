-- Optional single-file attachment per asset (purchase invoice, manual,
-- calibration certificate, etc. - see issue #2660).
--
-- Nullable, additive, no backfill.
-- attachmentPath is a bare storage path in the private `assets` bucket, not
-- a URL - it's resolved to a short-lived signed URL at the point of
-- display, never persisted as one.
ALTER TABLE "Asset" ADD COLUMN "attachmentPath" TEXT;
ALTER TABLE "Asset" ADD COLUMN "attachmentOriginalName" TEXT;
ALTER TABLE "Asset" ADD COLUMN "attachmentSize" INTEGER;

-- Postgres treats every NULL as distinct under a unique index, so this
-- does not constrain the (majority of) assets with no attachment - it only
-- guarantees one asset per storage path, closing the race between
-- createAsset's own not-already-claimed check and the actual insert.
CREATE UNIQUE INDEX "Asset_attachmentPath_key" ON "Asset"("attachmentPath");
