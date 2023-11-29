/*
  Warnings:

  - You are about to drop the column `fileUrl` on the `Template` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Template" DROP COLUMN "fileUrl",
ADD COLUMN     "pdfSize" INTEGER,
ADD COLUMN     "pdfUrl" TEXT;
