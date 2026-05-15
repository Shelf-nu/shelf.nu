-- CreateEnum
CREATE TYPE "SignedCustodyRequestStatus" AS ENUM ('PENDING', 'SIGNED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Organization"
ADD COLUMN "enableSignedCustodyOnAssignment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requireCustodySignatureOnAssignment" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SignedCustodyRequest" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "SignedCustodyRequestStatus" NOT NULL DEFAULT 'PENDING',
    "documentTitle" TEXT NOT NULL DEFAULT 'Custody agreement',
    "documentBody" TEXT NOT NULL DEFAULT 'Please review and sign to accept custody of this asset.',
    "signerName" TEXT,
    "signatureDataUrl" TEXT,
    "signerIp" TEXT,
    "signerUserAgent" TEXT,
    "signedAt" TIMESTAMPTZ(3),
    "organizationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,
    "requestedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SignedCustodyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignedCustodyRequest_token_key" ON "SignedCustodyRequest"("token");

-- CreateIndex
CREATE INDEX "SignedCustodyRequest_organizationId_idx" ON "SignedCustodyRequest"("organizationId");

-- CreateIndex
CREATE INDEX "SignedCustodyRequest_assetId_idx" ON "SignedCustodyRequest"("assetId");

-- CreateIndex
CREATE INDEX "SignedCustodyRequest_assetId_status_idx" ON "SignedCustodyRequest"("assetId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SignedCustodyRequest_one_pending_per_asset_idx" ON "SignedCustodyRequest"("assetId") WHERE "status" = 'PENDING';

-- CreateIndex
CREATE INDEX "SignedCustodyRequest_teamMemberId_idx" ON "SignedCustodyRequest"("teamMemberId");

-- CreateIndex
CREATE INDEX "SignedCustodyRequest_requestedById_idx" ON "SignedCustodyRequest"("requestedById");

-- CreateIndex
CREATE INDEX "SignedCustodyRequest_status_idx" ON "SignedCustodyRequest"("status");

-- AddForeignKey
ALTER TABLE "SignedCustodyRequest" ADD CONSTRAINT "SignedCustodyRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedCustodyRequest" ADD CONSTRAINT "SignedCustodyRequest_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedCustodyRequest" ADD CONSTRAINT "SignedCustodyRequest_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedCustodyRequest" ADD CONSTRAINT "SignedCustodyRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
