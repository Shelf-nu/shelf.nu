/*
  Warnings:

  - You are about to drop the column `kitId` on the `Note` table. All the data in the column will be lost.
  - You are about to drop the column `kitId` on the `Qr` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_kitId_fkey";

-- DropForeignKey
ALTER TABLE "Qr" DROP CONSTRAINT "Qr_kitId_fkey";

-- AlterTable
ALTER TABLE "Note" DROP COLUMN "kitId";

-- AlterTable
ALTER TABLE "Qr" DROP COLUMN "kitId";
