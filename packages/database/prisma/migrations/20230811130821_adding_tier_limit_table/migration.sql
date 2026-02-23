/*
  Warnings:

  - A unique constraint covering the columns `[tierLimitId]` on the table `Tier` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Tier" ADD COLUMN     "tierLimitId" "TierId";

-- CreateTable
CREATE TABLE "TierLimit" (
    "id" "TierId" NOT NULL,
    "canImportAssets" BOOLEAN NOT NULL DEFAULT false,
    "canExportAssets" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TierLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tier_tierLimitId_key" ON "Tier"("tierLimitId");

-- AddForeignKey
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_tierLimitId_fkey" FOREIGN KEY ("tierLimitId") REFERENCES "TierLimit"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Enable RLS
ALTER TABLE "TierLimit" ENABLE row level security;
