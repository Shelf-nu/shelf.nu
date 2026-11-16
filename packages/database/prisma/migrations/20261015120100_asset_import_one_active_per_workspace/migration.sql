-- At most one queued or running asset import per workspace.
-- Prisma cannot express a partial unique index, so it lives only in this
-- migration. Confirming a second import while one is active fails with a
-- unique violation instead of racing the application-level check.
CREATE UNIQUE INDEX "AssetImport_one_active_per_organization" ON "AssetImport"("organizationId") WHERE "status" IN ('QUEUED', 'RUNNING');
