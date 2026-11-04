-- Audits count units of quantity-tracked assets.
-- Both columns stay NULL for individual assets.
ALTER TABLE "AuditAsset" ADD COLUMN "expectedQuantity" INTEGER;
ALTER TABLE "AuditAsset" ADD COLUMN "foundQuantity" INTEGER;

ALTER TABLE "AuditAsset"
  ADD CONSTRAINT "AuditAsset_expectedQuantity_non_negative"
  CHECK ("expectedQuantity" IS NULL OR "expectedQuantity" >= 0);
ALTER TABLE "AuditAsset"
  ADD CONSTRAINT "AuditAsset_foundQuantity_non_negative"
  CHECK ("foundQuantity" IS NULL OR "foundQuantity" >= 0);

-- Audits still open get the expected units for their quantity-tracked rows,
-- so a pool that is never scanned is still reported (as "0 of N"). These
-- audits were started without a stored location scope, so they expect the
-- whole pool. Finished audits keep NULL: their counts were never taken.
UPDATE "AuditAsset" AS aa
SET "expectedQuantity" = COALESCE(a."quantity", 0)
FROM "Asset" AS a, "AuditSession" AS s
WHERE aa."assetId" = a."id"
  AND aa."auditSessionId" = s."id"
  AND a."type" = 'QUANTITY_TRACKED'
  AND s."status" IN ('PENDING', 'ACTIVE')
  AND aa."expectedQuantity" IS NULL;
