-- AlterTable
ALTER TABLE "CustomTierLimit" ADD COLUMN     "canImportNRM" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TierLimit" ADD COLUMN     "canImportNRM" BOOLEAN NOT NULL DEFAULT false;
