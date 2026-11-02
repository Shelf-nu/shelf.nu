-- Background asset imports: one row per CSV content import, from preview
-- (DRAFT) through the background job to COMPLETED or FAILED.

CREATE TYPE "AssetImportStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "AssetImportPhase" AS ENUM ('PREPARE', 'ROWS', 'FINALIZE');

CREATE TABLE "AssetImport" (
    "id" TEXT NOT NULL,
    "status" "AssetImportStatus" NOT NULL DEFAULT 'DRAFT',
    "phase" "AssetImportPhase" NOT NULL DEFAULT 'PREPARE',
    "fileName" TEXT,
    "totalRows" INTEGER NOT NULL,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "rows" JSONB,
    "resolved" JSONB,
    "canUseBarcodes" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "warnings" JSONB,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "AssetImport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssetImport_organizationId_status_idx" ON "AssetImport"("organizationId", "status");
CREATE INDEX "AssetImport_createdById_organizationId_status_idx" ON "AssetImport"("createdById", "organizationId", "status");

ALTER TABLE "AssetImport" ADD CONSTRAINT "AssetImport_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetImport" ADD CONSTRAINT "AssetImport_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS like every public table; the app connects as a role that bypasses it.
ALTER TABLE "AssetImport" ENABLE ROW LEVEL SECURITY;
