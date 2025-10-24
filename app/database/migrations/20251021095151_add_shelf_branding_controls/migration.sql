-- AlterTable
ALTER TABLE "public"."CustomTierLimit" ADD COLUMN     "canHideShelfBranding" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."Organization" ADD COLUMN     "showShelfBranding" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."TierLimit" ADD COLUMN     "canHideShelfBranding" BOOLEAN NOT NULL DEFAULT false;
