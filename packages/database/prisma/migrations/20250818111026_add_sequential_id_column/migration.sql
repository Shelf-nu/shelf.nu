/*
  Warnings:

  - A unique constraint covering the columns `[organizationId,sequentialId]` on the table `Asset` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Asset" ADD COLUMN     "sequentialId" TEXT;

-- CreateIndex
CREATE INDEX "Asset_sequentialId_idx" ON "public"."Asset"("sequentialId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_organizationId_sequentialId_key" ON "public"."Asset"("organizationId", "sequentialId");
