-- AlterTable
ALTER TABLE "ReportFound" ADD COLUMN     "kitId" TEXT,
ALTER COLUMN "assetId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ReportFound" ADD CONSTRAINT "ReportFound_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "Kit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
