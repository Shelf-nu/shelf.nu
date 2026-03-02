-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "barcodesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "barcodesEnabledAt" TIMESTAMP(3);
