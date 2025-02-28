/*
  Warnings:

  - You are about to drop the column `associatedTemplateVersion` on the `Custody` table. All the data in the column will be lost.
  - You are about to drop the column `templateId` on the `Custody` table. All the data in the column will be lost.
  - You are about to drop the column `templateSigned` on the `Custody` table. All the data in the column will be lost.
  - You are about to drop the column `maxTemplates` on the `CustomTierLimit` table. All the data in the column will be lost.
  - You are about to drop the column `maxTemplates` on the `TierLimit` table. All the data in the column will be lost.
  - You are about to drop the `Template` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TemplateFile` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "CustodyStatus" AS ENUM ('ACTIVE', 'FINISHED');

-- CreateEnum
CREATE TYPE "CustodySignatureStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SIGNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustodyAgreementType" AS ENUM ('CUSTODY', 'BOOKINGS');

-- DropForeignKey
ALTER TABLE "Custody" DROP CONSTRAINT "Custody_templateId_fkey";

-- DropForeignKey
ALTER TABLE "Template" DROP CONSTRAINT "Template_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Template" DROP CONSTRAINT "Template_userId_fkey";

-- DropForeignKey
ALTER TABLE "TemplateFile" DROP CONSTRAINT "TemplateFile_templateId_fkey";

-- AlterTable
ALTER TABLE "Custody" DROP COLUMN "associatedTemplateVersion",
DROP COLUMN "templateId",
DROP COLUMN "templateSigned",
ADD COLUMN     "agreementId" TEXT,
ADD COLUMN     "agreementSigned" BOOLEAN DEFAULT false,
ADD COLUMN     "agreementSignedOn" TIMESTAMP(3),
ADD COLUMN     "associatedAgreementVersion" INTEGER,
ADD COLUMN     "signatureStatus" "CustodySignatureStatus" DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "status" "CustodyStatus" DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "CustomTierLimit" DROP COLUMN "maxTemplates",
ADD COLUMN     "maxCustodyAgreements" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "TierLimit" DROP COLUMN "maxTemplates",
ADD COLUMN     "maxCustodyAgreements" INTEGER NOT NULL DEFAULT 3;

-- DropTable
DROP TABLE "Template";

-- DropTable
DROP TABLE "TemplateFile";

-- DropEnum
DROP TYPE "TemplateType";

-- CreateTable
CREATE TABLE "CustodyAgreement" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "CustodyAgreementType" NOT NULL DEFAULT 'CUSTODY',
    "signatureRequired" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "CustodyAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustodyAgreementFile" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "custodyAgreementId" TEXT NOT NULL,

    CONSTRAINT "CustodyAgreementFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustodyAgreementFile_revision_custodyAgreementId_key" ON "CustodyAgreementFile"("revision", "custodyAgreementId");

-- AddForeignKey
ALTER TABLE "Custody" ADD CONSTRAINT "Custody_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CustodyAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyAgreement" ADD CONSTRAINT "CustodyAgreement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyAgreement" ADD CONSTRAINT "CustodyAgreement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyAgreementFile" ADD CONSTRAINT "CustodyAgreementFile_custodyAgreementId_fkey" FOREIGN KEY ("custodyAgreementId") REFERENCES "CustodyAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
