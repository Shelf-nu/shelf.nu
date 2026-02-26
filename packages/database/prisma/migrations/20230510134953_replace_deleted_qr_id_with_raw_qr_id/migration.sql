/*
  Warnings:

  - You are about to drop the column `deletedQrId` on the `Scan` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Scan" DROP COLUMN "deletedQrId",
ADD COLUMN     "rawQrId" TEXT;
