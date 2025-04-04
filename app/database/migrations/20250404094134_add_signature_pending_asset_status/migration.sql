-- AlterEnum
ALTER TYPE "AssetStatus" ADD VALUE 'SIGNATURE_PENDING';

-- AlterTable
ALTER TABLE "CustomTierLimit" ALTER COLUMN "maxCustodyAgreements" SET DEFAULT 20;
