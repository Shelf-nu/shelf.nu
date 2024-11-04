-- AlterTable
ALTER TABLE "AssetIndexSettings" ADD COLUMN     "freezeColumn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showAssetImage" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "AssetIndexSettings" ADD CONSTRAINT "AssetIndexSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
