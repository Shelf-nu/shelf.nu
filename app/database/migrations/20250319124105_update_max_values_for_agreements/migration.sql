-- AlterTable
ALTER TABLE "CustomTierLimit" ADD COLUMN     "maxActiveCustodyAgreements" INTEGER NOT NULL DEFAULT 5,
ALTER COLUMN "maxCustodyAgreements" SET DEFAULT 10;

-- AlterTable
ALTER TABLE "TierLimit" ADD COLUMN     "maxActiveCustodyAgreements" INTEGER NOT NULL DEFAULT 5,
ALTER COLUMN "maxCustodyAgreements" SET DEFAULT 10;
