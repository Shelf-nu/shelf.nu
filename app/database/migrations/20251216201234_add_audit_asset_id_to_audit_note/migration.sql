-- DropForeignKey
ALTER TABLE "AuditImage" DROP CONSTRAINT "AuditImage_auditAssetId_fkey";

-- AlterTable
ALTER TABLE "AuditNote" ADD COLUMN     "auditAssetId" TEXT;

-- CreateIndex
CREATE INDEX "AuditNote_auditAssetId_idx" ON "AuditNote"("auditAssetId");

-- AddForeignKey
ALTER TABLE "AuditNote" ADD CONSTRAINT "AuditNote_auditAssetId_fkey" FOREIGN KEY ("auditAssetId") REFERENCES "AuditAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditImage" ADD CONSTRAINT "AuditImage_auditAssetId_fkey" FOREIGN KEY ("auditAssetId") REFERENCES "AuditAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
