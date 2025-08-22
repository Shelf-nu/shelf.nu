-- CreateEnum
CREATE TYPE "public"."AuditType" AS ENUM ('LOCATION', 'KIT');

-- CreateEnum
CREATE TYPE "public"."AuditStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "public"."AuditSession" (
    "id" TEXT NOT NULL,
    "type" "public"."AuditType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" "public"."AuditStatus" NOT NULL DEFAULT 'ACTIVE',
    "expectedAssetCount" INTEGER NOT NULL DEFAULT 0,
    "foundAssetCount" INTEGER NOT NULL DEFAULT 0,
    "missingAssetCount" INTEGER NOT NULL DEFAULT 0,
    "unexpectedAssetCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AuditSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditSession_organizationId_type_targetId_idx" ON "public"."AuditSession"("organizationId", "type", "targetId");

-- CreateIndex
CREATE INDEX "AuditSession_createdById_idx" ON "public"."AuditSession"("createdById");

-- CreateIndex
CREATE INDEX "AuditSession_status_createdAt_idx" ON "public"."AuditSession"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."AuditSession" ADD CONSTRAINT "AuditSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditSession" ADD CONSTRAINT "AuditSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
