-- AlterEnum
ALTER TYPE "KitStatus" ADD VALUE 'SIGNATURE_PENDING';

-- AlterTable
ALTER TABLE "KitCustody" ADD COLUMN     "agreementId" TEXT,
ADD COLUMN     "agreementSigned" BOOLEAN DEFAULT false,
ADD COLUMN     "agreementSignedOn" TIMESTAMP(3),
ADD COLUMN     "signatureImage" TEXT,
ADD COLUMN     "signatureStatus" "CustodySignatureStatus" DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "signatureText" TEXT;

-- AddForeignKey
ALTER TABLE "KitCustody" ADD CONSTRAINT "KitCustody_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CustodyAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
