-- Extend QrIdDisplayPreference enum with the 5 barcode types from BarcodeType.
-- Single workspace preference now governs both label printing AND list display.
-- Barcode-type values are only meaningful when Organization.barcodesEnabled = true
-- (gated in the workspace settings UI), but the schema permits them universally;
-- the application-layer resolver falls back to QR_ID for non-addon orgs.
ALTER TYPE "QrIdDisplayPreference" ADD VALUE 'Code128';
ALTER TYPE "QrIdDisplayPreference" ADD VALUE 'Code39';
ALTER TYPE "QrIdDisplayPreference" ADD VALUE 'DataMatrix';
ALTER TYPE "QrIdDisplayPreference" ADD VALUE 'ExternalQR';
ALTER TYPE "QrIdDisplayPreference" ADD VALUE 'EAN13';

-- Per-asset override pointing at a specific Barcode row. Null = use the
-- workspace `qrIdDisplayPreference` default. Marked UNIQUE so the Prisma
-- back-relation on Barcode resolves to `Asset?` (1:1) instead of `Asset[]`.
ALTER TABLE "Asset" ADD COLUMN "preferredBarcodeId" TEXT;
CREATE UNIQUE INDEX "Asset_preferredBarcodeId_key" ON "Asset"("preferredBarcodeId");
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_preferredBarcodeId_fkey"
  FOREIGN KEY ("preferredBarcodeId") REFERENCES "Barcode"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- New ActivityAction enum values for events emitted when the per-asset
-- preferred-barcode changes and when the workspace identifier preference
-- changes. The enum's banner comment requires additive-only changes.
ALTER TYPE "ActivityAction" ADD VALUE 'ASSET_PREFERRED_BARCODE_CHANGED';
ALTER TYPE "ActivityAction" ADD VALUE 'ORGANIZATION_QR_ID_DISPLAY_PREFERENCE_CHANGED';
