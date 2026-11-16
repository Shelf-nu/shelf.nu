-- Every scan belongs to the workspace its code resolved in. The code has
-- required that on every write since scans began recording their workspace;
-- this makes the column required too. It runs unattended, so it also settles
-- every row that still has no workspace.

-- One transaction, so a failure leaves nothing half-done. The lock blocks
-- writes to "Scan" (reads carry on) from the cleanup until the constraint is
-- in place: an older writer still serving could otherwise insert a row with
-- no workspace after the DELETE, and SET NOT NULL would fail on it.
BEGIN;

LOCK TABLE "Scan" IN SHARE ROW EXCLUSIVE MODE;

-- Stamp rows whose QR still exists with the asset, kit and workspace it points
-- at. These are QR scans recorded by code that did not stamp the scan itself:
-- rows written between the previous migration and the deploy that followed
-- it. Only columns that are still NULL are filled.
UPDATE "Scan" s
SET "organizationId" = q."organizationId",
    "assetId" = COALESCE(s."assetId", q."assetId"),
    "kitId" = COALESCE(s."kitId", q."kitId"),
    "code" = COALESCE(s."code", s."rawQrId")
FROM "Qr" q
WHERE s."qrId" = q."id"
  AND s."organizationId" IS NULL
  AND q."organizationId" IS NOT NULL;

-- What is left belongs to no workspace: scans of QR codes nobody had claimed,
-- or whose QR was deleted. No surface can show them and no workspace owns
-- them, so they are removed.
DELETE FROM "Scan" WHERE "organizationId" IS NULL;

-- AlterTable
ALTER TABLE "Scan" ALTER COLUMN "organizationId" SET NOT NULL;

COMMIT;
