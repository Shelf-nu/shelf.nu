-- AlterTable
ALTER TABLE "CustodyReceipt" ADD COLUMN     "kitId" TEXT,
ALTER COLUMN "assetId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "CustodyReceipt" ADD CONSTRAINT "CustodyReceipt_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "Kit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
