/*
  Warnings:

  - A unique constraint covering the columns `[assetId,teamMemberId]` on the table `Custody` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Custody_assetId_key";

-- AlterTable
ALTER TABLE "Custody" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "Custody_assetId_teamMemberId_key" ON "Custody"("assetId", "teamMemberId");
