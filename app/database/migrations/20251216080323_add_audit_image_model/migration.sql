-- CreateTable
CREATE TABLE "AuditImage" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "description" TEXT,
    "auditSessionId" TEXT NOT NULL,
    "auditAssetId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditImage_auditSessionId_idx" ON "AuditImage"("auditSessionId");

-- CreateIndex
CREATE INDEX "AuditImage_auditAssetId_idx" ON "AuditImage"("auditAssetId");

-- CreateIndex
CREATE INDEX "AuditImage_organizationId_idx" ON "AuditImage"("organizationId");

-- CreateIndex
CREATE INDEX "AuditImage_uploadedById_idx" ON "AuditImage"("uploadedById");

-- AddForeignKey
ALTER TABLE "AuditImage" ADD CONSTRAINT "AuditImage_auditSessionId_fkey" FOREIGN KEY ("auditSessionId") REFERENCES "AuditSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditImage" ADD CONSTRAINT "AuditImage_auditAssetId_fkey" FOREIGN KEY ("auditAssetId") REFERENCES "AuditAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditImage" ADD CONSTRAINT "AuditImage_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditImage" ADD CONSTRAINT "AuditImage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
