-- AlterTable
ALTER TABLE "Kit" ADD COLUMN     "locationId" TEXT;

-- AddForeignKey
ALTER TABLE "Kit" ADD CONSTRAINT "Kit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
