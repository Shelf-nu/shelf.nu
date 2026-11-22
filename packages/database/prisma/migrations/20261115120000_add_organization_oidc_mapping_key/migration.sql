-- Links a workspace to the entry of the OIDC_WORKSPACE_MAPPINGS configuration
-- that manages its membership (custom OIDC login). Null for every workspace
-- that is not managed by an OIDC group mapping.
ALTER TABLE "Organization" ADD COLUMN "oidcMappingKey" TEXT;

-- One workspace per mapping entry. This is also what makes creating the
-- workspace on first login safe when two mapped admins sign in at once.
CREATE UNIQUE INDEX "Organization_oidcMappingKey_key" ON "Organization"("oidcMappingKey");
