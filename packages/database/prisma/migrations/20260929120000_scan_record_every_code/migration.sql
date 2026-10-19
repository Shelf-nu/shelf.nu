-- Record every scan, not only QR scans: a Scan row now carries what kind of
-- code was scanned, its value, which surface recorded it, and the asset, kit
-- and workspace the code resolved to. Additive only: new nullable columns, two
-- new enums, rawQrId relaxed to nullable (barcode and SAM ID scans have none).

-- CreateEnum
CREATE TYPE "ScanCodeType" AS ENUM ('QR', 'BARCODE', 'SAM_ID');

-- CreateEnum
CREATE TYPE "ScanSource" AS ENUM ('QR_LINK', 'WEB_SCANNER', 'WEB_DRAWER', 'AUDIT', 'COMPANION', 'GPS_UPDATE');

-- AlterTable
ALTER TABLE "Scan" ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "barcodeId" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "codeType" "ScanCodeType" NOT NULL DEFAULT 'QR',
ADD COLUMN     "kitId" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "source" "ScanSource",
ALTER COLUMN "rawQrId" DROP NOT NULL;

-- Backfill: every existing row is a QR scan. Stamp the asset, kit and
-- workspace its QR points at today, which is exactly what the last-scan card
-- showed for it when it read by QR, and copy the scanned value into "code".
-- "source" stays NULL: the surface that recorded an old row is not known.
-- Runs before the indexes are built so the UPDATE does not maintain them.
UPDATE "Scan" s
SET "assetId" = q."assetId",
    "kitId" = q."kitId",
    "organizationId" = q."organizationId",
    "code" = s."rawQrId"
FROM "Qr" q
WHERE s."qrId" = q."id";

-- Rows whose QR has since been deleted keep only the raw id.
UPDATE "Scan"
SET "code" = "rawQrId"
WHERE "qrId" IS NULL;

-- CreateIndex
CREATE INDEX "Scan_assetId_createdAt_idx" ON "Scan"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "Scan_kitId_createdAt_idx" ON "Scan"("kitId", "createdAt");

-- CreateIndex
CREATE INDEX "Scan_barcodeId_idx" ON "Scan"("barcodeId");

-- CreateIndex
CREATE INDEX "Scan_organizationId_idx" ON "Scan"("organizationId");

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_barcodeId_fkey" FOREIGN KEY ("barcodeId") REFERENCES "Barcode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "Kit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
