/*
  Warnings:

  - Added the required column `organizationId` to the `AssetReminder` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AssetReminder" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "AssetReminder" ADD CONSTRAINT "AssetReminder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
