/*
  Warnings:

  - Made the column `rawQrId` on table `Scan` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Scan" ALTER COLUMN "rawQrId" SET NOT NULL;
