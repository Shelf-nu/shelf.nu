-- Auto-generated asset QRs share the asset createdAt timestamp and are created
-- already linked to the asset. For historical data, only infer an applied
-- physical label when the QR row already existed and was later updated/linked.
-- Fresh replacement/import-created QR rows are intentionally left null because
-- their timestamps cannot prove a sticker was actually applied.
WITH inferred_label_assignments AS (
  SELECT
    a.id AS "assetId",
    MIN(q."updatedAt") AS "appliedAt"
  FROM "Asset" a
  JOIN "Qr" q
    ON q."assetId" = a.id
    AND q."kitId" IS NULL
    AND (
      q."organizationId" IS NULL OR
      q."organizationId" = a."organizationId"
    )
  WHERE q."createdAt" IS DISTINCT FROM a."createdAt"
    AND q."updatedAt" > q."createdAt"
  GROUP BY a.id
)
UPDATE "Asset" a
SET "qrLabelAppliedAt" = i."appliedAt"
FROM inferred_label_assignments i
WHERE a.id = i."assetId"
  AND a."qrLabelAppliedAt" IS NULL;
