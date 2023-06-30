-- DropForeignKey
ALTER TABLE "Location" DROP CONSTRAINT "Location_imageId_fkey";

-- AlterTable
ALTER TABLE "Location" ALTER COLUMN "imageId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;
