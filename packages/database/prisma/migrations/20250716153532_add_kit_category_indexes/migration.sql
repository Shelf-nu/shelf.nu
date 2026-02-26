-- Index for filtering kits by category within organization
CREATE INDEX IF NOT EXISTS "Kit_categoryId_organizationId_idx" ON "Kit" ("categoryId", "organizationId");
-- Index for filtering kits by category, organization, and status (common filtering pattern)
CREATE INDEX IF NOT EXISTS "Kit_categoryId_organizationId_status_idx" ON "Kit" ("categoryId", "organizationId", "status");
-- Index for filtering kits by category and created date within organization (for sorting)
CREATE INDEX IF NOT EXISTS "Kit_categoryId_organizationId_createdAt_idx" ON "Kit" ("categoryId", "organizationId", "createdAt");
-- Index for filtering kits by category and name within organization (for search)
CREATE INDEX IF NOT EXISTS "Kit_categoryId_organizationId_name_idx" ON "Kit" ("categoryId", "organizationId", "name");