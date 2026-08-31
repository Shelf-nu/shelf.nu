-- Optional single-file attachment per asset (purchase invoice, manual,
-- calibration certificate, etc. - see issue #2660).
--
-- Nullable, additive, no backfill - safe at Shelf's table scale, no lock
-- concern. attachmentUrl is a full public URL (same shape as
-- Location.imageUrl / AuditImage.imageUrl), not a bare storage path.
ALTER TABLE "Asset" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "Asset" ADD COLUMN "attachmentOriginalName" TEXT;
ALTER TABLE "Asset" ADD COLUMN "attachmentSize" INTEGER;
