/*
  Warnings:

  - You are about to drop the column `pdfName` on the `Template` table. All the data in the column will be lost.
  - You are about to drop the column `pdfSize` on the `Template` table. All the data in the column will be lost.
  - You are about to drop the column `pdfUrl` on the `Template` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Custody" ADD COLUMN     "associatedTemplateVersion" INTEGER;

-- AlterTable
ALTER TABLE "Template" DROP COLUMN "pdfName",
DROP COLUMN "pdfSize",
DROP COLUMN "pdfUrl",
ADD COLUMN     "lastRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TemplateFile" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,

    CONSTRAINT "TemplateFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateFile_revision_templateId_key" ON "TemplateFile"("revision", "templateId");

-- AddForeignKey
ALTER TABLE "TemplateFile" ADD CONSTRAINT "TemplateFile_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
