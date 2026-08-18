-- Asset archiving: soft "out of view" state, orthogonal to Asset.status.
-- Null = active; non-null = archived (hidden from default lists, not bookable,
-- reinstatable). Additive + nullable, so all existing rows are "active" with no
-- backfill, and the column is non-blocking to add on PostgreSQL.

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3);

-- CreateIndex
-- Keeps the default "active assets" filter (archivedAt IS NULL) on an index scan.
CREATE INDEX "Asset_organizationId_archivedAt_idx" ON "Asset"("organizationId", "archivedAt");
