/*
  Warnings:

  - You are about to drop the column `status` on the `Custody` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "CustodyStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "Custody" DROP COLUMN "status";

-- CreateTable
CREATE TABLE "CustodyReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "custodianId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "agreementId" TEXT,
    "custodyStatus" "CustodyStatus" NOT NULL DEFAULT 'ACTIVE',
    "signatureStatus" "CustodySignatureStatus" NOT NULL,
    "agreementSigned" BOOLEAN NOT NULL DEFAULT false,
    "associatedAgreementVersion" INTEGER,
    "signatureText" TEXT,
    "signatureImage" TEXT,
    "agreementSignedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustodyReceipt_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CustodyReceipt" ADD CONSTRAINT "CustodyReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyReceipt" ADD CONSTRAINT "CustodyReceipt_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyReceipt" ADD CONSTRAINT "CustodyReceipt_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyReceipt" ADD CONSTRAINT "CustodyReceipt_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CustodyAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
