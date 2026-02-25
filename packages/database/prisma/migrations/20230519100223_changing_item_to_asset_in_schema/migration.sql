/*
  Warnings:

  - You are about to drop the column `itemId` on the `Note` table. All the data in the column will be lost.
  - You are about to drop the column `itemId` on the `Qr` table. All the data in the column will be lost.
  - You are about to drop the column `itemId` on the `ReportFound` table. All the data in the column will be lost.
  - Added the required column `assetId` to the `Note` table without a default value. This is not possible if the table is not empty.
  - Added the required column `assetId` to the `ReportFound` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_itemId_fkey";

-- DropForeignKey
ALTER TABLE "Qr" DROP CONSTRAINT "Qr_itemId_fkey";

-- DropForeignKey
ALTER TABLE "ReportFound" DROP CONSTRAINT "ReportFound_itemId_fkey";

-- AlterTable
ALTER TABLE "Asset" RENAME CONSTRAINT "Item_pkey" TO "Asset_pkey";

-- AlterTable
ALTER TABLE "Note" DROP COLUMN "itemId",
ADD COLUMN     "assetId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Qr" DROP COLUMN "itemId",
ADD COLUMN     "assetId" TEXT;

-- AlterTable
ALTER TABLE "ReportFound" DROP COLUMN "itemId",
ADD COLUMN     "assetId" TEXT NOT NULL;

-- RenameForeignKey
ALTER TABLE "Asset" RENAME CONSTRAINT "Item_categoryId_fkey" TO "Asset_categoryId_fkey";

-- RenameForeignKey
ALTER TABLE "Asset" RENAME CONSTRAINT "Item_userId_fkey" TO "Asset_userId_fkey";

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Qr" ADD CONSTRAINT "Qr_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportFound" ADD CONSTRAINT "ReportFound_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
