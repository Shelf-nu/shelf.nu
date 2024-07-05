/*
  Warnings:

  - A unique constraint covering the columns `[propertyId]` on the table `Asset` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "propertyId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Asset_propertyId_key" ON "Asset"("propertyId");
