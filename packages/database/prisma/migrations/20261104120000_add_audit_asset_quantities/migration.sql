-- Audits count units of quantity-tracked assets.
-- Both columns stay NULL for individual assets and for every existing row.
ALTER TABLE "AuditAsset" ADD COLUMN "expectedQuantity" INTEGER;
ALTER TABLE "AuditAsset" ADD COLUMN "foundQuantity" INTEGER;

ALTER TABLE "AuditAsset"
  ADD CONSTRAINT "AuditAsset_expectedQuantity_non_negative"
  CHECK ("expectedQuantity" IS NULL OR "expectedQuantity" >= 0);
ALTER TABLE "AuditAsset"
  ADD CONSTRAINT "AuditAsset_foundQuantity_non_negative"
  CHECK ("foundQuantity" IS NULL OR "foundQuantity" >= 0);
