-- CreateEnum
CREATE TYPE "AssetFilterPresetView" AS ENUM ('table', 'availability');

-- CreateTable
CREATE TABLE "AssetFilterPreset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "view" "AssetFilterPresetView" NOT NULL DEFAULT 'table',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetFilterPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_filter_presets_owner_lookup_idx" ON "AssetFilterPreset"("organizationId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_filter_presets_owner_name_unique" ON "AssetFilterPreset"("organizationId", "ownerId", "name");

-- AddForeignKey
ALTER TABLE "AssetFilterPreset" ADD CONSTRAINT "AssetFilterPreset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetFilterPreset" ADD CONSTRAINT "AssetFilterPreset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
