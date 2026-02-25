-- CreateEnum
CREATE TYPE "public"."AuditStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."AuditAssetStatus" AS ENUM ('PENDING', 'FOUND', 'MISSING', 'UNEXPECTED');

-- CreateEnum
CREATE TYPE "public"."AuditAssignmentRole" AS ENUM ('LEAD', 'PARTICIPANT');

-- CreateTable
CREATE TABLE "public"."AuditSession" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetId" TEXT,
    "status" "public"."AuditStatus" NOT NULL DEFAULT 'PENDING',
    "scopeMeta" JSONB,
    "expectedAssetCount" INTEGER NOT NULL DEFAULT 0,
    "foundAssetCount" INTEGER NOT NULL DEFAULT 0,
    "missingAssetCount" INTEGER NOT NULL DEFAULT 0,
    "unexpectedAssetCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditAssignment" (
    "id" TEXT NOT NULL,
    "auditSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."AuditAssignmentRole",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditAsset" (
    "id" TEXT NOT NULL,
    "auditSessionId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "expected" BOOLEAN NOT NULL DEFAULT true,
    "status" "public"."AuditAssetStatus" NOT NULL DEFAULT 'PENDING',
    "scannedById" TEXT,
    "scannedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditScan" (
    "id" TEXT NOT NULL,
    "auditSessionId" TEXT NOT NULL,
    "auditAssetId" TEXT,
    "assetId" TEXT,
    "scannedById" TEXT,
    "code" TEXT,
    "metadata" JSONB,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditSession_organizationId_status_idx" ON "public"."AuditSession"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AuditSession_createdById_idx" ON "public"."AuditSession"("createdById");

-- CreateIndex
CREATE INDEX "AuditSession_status_createdAt_idx" ON "public"."AuditSession"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditAssignment_userId_idx" ON "public"."AuditAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditAssignment_auditSessionId_userId_key" ON "public"."AuditAssignment"("auditSessionId", "userId");

-- CreateIndex
CREATE INDEX "AuditAsset_status_idx" ON "public"."AuditAsset"("status");

-- CreateIndex
CREATE INDEX "AuditAsset_scannedById_idx" ON "public"."AuditAsset"("scannedById");

-- CreateIndex
CREATE UNIQUE INDEX "AuditAsset_auditSessionId_assetId_key" ON "public"."AuditAsset"("auditSessionId", "assetId");

-- CreateIndex
CREATE INDEX "AuditScan_auditSessionId_scannedAt_idx" ON "public"."AuditScan"("auditSessionId", "scannedAt");

-- CreateIndex
CREATE INDEX "AuditScan_auditAssetId_idx" ON "public"."AuditScan"("auditAssetId");

-- CreateIndex
CREATE INDEX "AuditScan_assetId_idx" ON "public"."AuditScan"("assetId");

-- AddForeignKey
ALTER TABLE "public"."AuditSession" ADD CONSTRAINT "AuditSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditSession" ADD CONSTRAINT "AuditSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditAssignment" ADD CONSTRAINT "AuditAssignment_auditSessionId_fkey" FOREIGN KEY ("auditSessionId") REFERENCES "public"."AuditSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditAssignment" ADD CONSTRAINT "AuditAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditAsset" ADD CONSTRAINT "AuditAsset_auditSessionId_fkey" FOREIGN KEY ("auditSessionId") REFERENCES "public"."AuditSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditAsset" ADD CONSTRAINT "AuditAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditAsset" ADD CONSTRAINT "AuditAsset_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditScan" ADD CONSTRAINT "AuditScan_auditSessionId_fkey" FOREIGN KEY ("auditSessionId") REFERENCES "public"."AuditSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditScan" ADD CONSTRAINT "AuditScan_auditAssetId_fkey" FOREIGN KEY ("auditAssetId") REFERENCES "public"."AuditAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditScan" ADD CONSTRAINT "AuditScan_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditScan" ADD CONSTRAINT "AuditScan_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "public"."AuditSession" ENABLE row level security;
ALTER TABLE "public"."AuditAssignment" ENABLE row level security;
ALTER TABLE "public"."AuditAsset" ENABLE row level security;
ALTER TABLE "public"."AuditScan" ENABLE row level security;
