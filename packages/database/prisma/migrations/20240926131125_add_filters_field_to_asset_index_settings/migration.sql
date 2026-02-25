-- AlterTable
ALTER TABLE "AssetIndexSettings" ADD COLUMN     "filters" JSONB NOT NULL DEFAULT '{}';
