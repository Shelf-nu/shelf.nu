-- DropIndex
DROP INDEX "Asset_title_description_idx";

-- DropIndex
DROP INDEX "TeamMember_name_idx";

-- AlterTable
ALTER TABLE "AssetReminder" ADD COLUMN     "activeSchedulerReference" TEXT;
