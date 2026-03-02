-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ALTER COLUMN "name" SET DEFAULT 'Personal';

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
