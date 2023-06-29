/*
  Warnings:

  - You are about to drop the column `image` on the `Location` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[imageId]` on the table `Location` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `imageId` to the `Location` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Location" DROP COLUMN "image",
ADD COLUMN     "imageId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Image" (
    "id" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "altText" TEXT,
    "blob" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_imageId_key" ON "Location"("imageId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
