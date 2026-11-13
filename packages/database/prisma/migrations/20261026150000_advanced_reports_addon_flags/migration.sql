-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "advancedReportsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "advancedReportsEnabledAt" TIMESTAMP(3),
ADD COLUMN     "usedAdvancedReportsTrial" BOOLEAN NOT NULL DEFAULT false;
