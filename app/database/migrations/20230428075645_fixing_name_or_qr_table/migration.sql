/*
  Warnings:

  - You are about to drop the `QR` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "QR" DROP CONSTRAINT "QR_itemId_fkey";

-- DropForeignKey
ALTER TABLE "QR" DROP CONSTRAINT "QR_userId_fkey";

-- DropTable
DROP TABLE "QR";

-- CreateTable
CREATE TABLE "Qr" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "errorCorrection" "ErrorCorrection" NOT NULL DEFAULT 'L',
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Qr_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Qr" ADD CONSTRAINT "Qr_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Qr" ADD CONSTRAINT "Qr_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
