-- CreateEnum
CREATE TYPE "ErrorCorrection" AS ENUM ('L', 'M', 'Q', 'H');

-- CreateTable
CREATE TABLE "QR" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "errorCorrection" "ErrorCorrection" NOT NULL DEFAULT 'L',
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QR_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "QR" ADD CONSTRAINT "QR_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QR" ADD CONSTRAINT "QR_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "QR" ENABLE row level security;