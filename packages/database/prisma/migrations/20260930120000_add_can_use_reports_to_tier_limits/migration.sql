-- AlterTable
ALTER TABLE "public"."CustomTierLimit" ADD COLUMN     "canUseReports" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."TierLimit" ADD COLUMN     "canUseReports" BOOLEAN NOT NULL DEFAULT false;

-- Reports are part of the Plus (tier_1) and Team (tier_2) plans. Free stays false.
UPDATE "public"."TierLimit"
SET "canUseReports" = true
WHERE id IN ('tier_1', 'tier_2');
