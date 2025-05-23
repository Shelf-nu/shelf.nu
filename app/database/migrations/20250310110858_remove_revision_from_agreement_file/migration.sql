/*
  Warnings:

  - You are about to drop the column `associatedAgreementVersion` on the `Custody` table. All the data in the column will be lost.
  - You are about to drop the column `lastRevision` on the `CustodyAgreement` table. All the data in the column will be lost.
  - You are about to drop the column `revision` on the `CustodyAgreementFile` table. All the data in the column will be lost.
  - You are about to drop the column `associatedAgreementVersion` on the `CustodyReceipt` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[custodyAgreementId]` on the table `CustodyAgreementFile` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "CustodyAgreementFile_revision_custodyAgreementId_key";

-- AlterTable
ALTER TABLE "Custody" DROP COLUMN "associatedAgreementVersion";

-- AlterTable
ALTER TABLE "CustodyAgreement" DROP COLUMN "lastRevision";

-- AlterTable
ALTER TABLE "CustodyAgreementFile" DROP COLUMN "revision";

-- AlterTable
ALTER TABLE "CustodyReceipt" DROP COLUMN "associatedAgreementVersion";

-- CreateIndex
CREATE UNIQUE INDEX "CustodyAgreementFile_custodyAgreementId_key" ON "CustodyAgreementFile"("custodyAgreementId");
