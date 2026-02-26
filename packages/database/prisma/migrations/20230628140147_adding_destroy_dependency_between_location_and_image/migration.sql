-- DropForeignKey
ALTER TABLE "Location" DROP CONSTRAINT "Location_imageId_fkey";

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE;
