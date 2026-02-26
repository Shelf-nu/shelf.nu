-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "auditsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "auditsEnabledAt" TIMESTAMP(3),
ADD COLUMN     "usedAuditTrial" BOOLEAN NOT NULL DEFAULT false;
