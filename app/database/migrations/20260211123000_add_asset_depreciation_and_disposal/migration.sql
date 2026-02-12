-- Add disposed status to asset status enum
ALTER TYPE "AssetStatus" ADD VALUE IF NOT EXISTS 'DISPOSED';

-- Add disposed date to Asset
ALTER TABLE "Asset" ADD COLUMN "disposedAt" TIMESTAMP(3);

-- Depreciation period enum
CREATE TYPE "DepreciationPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- Asset depreciation settings
CREATE TABLE "AssetDepreciation" (
  "id" TEXT NOT NULL,
  "depreciationRate" DOUBLE PRECISION NOT NULL,
  "period" "DepreciationPeriod" NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "residualValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "assetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AssetDepreciation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetDepreciation_assetId_key" ON "AssetDepreciation"("assetId");
CREATE INDEX "AssetDepreciation_assetId_idx" ON "AssetDepreciation"("assetId");

ALTER TABLE "AssetDepreciation"
ADD CONSTRAINT "AssetDepreciation_assetId_fkey"
FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
