/*
  Warnings:

  - Made the column `organizationId` on table `Asset` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_organizationId_fkey";

-- AlterTable
ALTER TABLE "Asset" ALTER COLUMN "organizationId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
