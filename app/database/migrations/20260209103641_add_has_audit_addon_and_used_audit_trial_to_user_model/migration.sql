-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hasAuditAddon" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "usedAuditTrial" BOOLEAN NOT NULL DEFAULT false;
