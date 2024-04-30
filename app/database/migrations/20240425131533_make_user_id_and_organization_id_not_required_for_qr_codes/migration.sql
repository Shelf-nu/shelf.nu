-- DropForeignKey
ALTER TABLE "Qr" DROP CONSTRAINT "Qr_organizationId_fkey";

-- AlterTable
ALTER TABLE "Qr" ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "organizationId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Qr" ADD CONSTRAINT "Qr_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
