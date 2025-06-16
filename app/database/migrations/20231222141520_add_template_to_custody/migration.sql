/*
  Warnings:

  - A unique constraint covering the columns `[templateId]` on the table `Custody` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Custody" ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "templateSigned" BOOLEAN DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Custody_templateId_key" ON "Custody"("templateId");

-- AddForeignKey
ALTER TABLE "Custody" ADD CONSTRAINT "Custody_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
