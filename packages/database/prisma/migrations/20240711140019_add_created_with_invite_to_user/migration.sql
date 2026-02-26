-- DropForeignKey
ALTER TABLE "Qr" DROP CONSTRAINT "Qr_userId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "createdWithInvite" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Qr" ADD CONSTRAINT "Qr_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
