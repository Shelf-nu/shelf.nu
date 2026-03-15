-- =============================================================================
-- 003_modify_for_msp.sql
-- Modify existing tables for MSP context
-- Alters: Asset, Organization, TeamMember, ReportFound
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Asset — add MSP columns
--    person_id FK deferred to 004 (person table not yet created)
-- ---------------------------------------------------------------------------
ALTER TABLE "Asset"
  ADD COLUMN IF NOT EXISTS person_id uuid,
  ADD COLUMN IF NOT EXISTS replacement_value double precision,
  ADD COLUMN IF NOT EXISTS cw_configuration_id text,
  ADD COLUMN IF NOT EXISTS ninja_device_id text;

-- Indexes for new Asset columns
CREATE INDEX IF NOT EXISTS "Asset_person_id_idx" ON "Asset" (person_id);
CREATE INDEX IF NOT EXISTS "Asset_cw_configuration_id_idx" ON "Asset" (cw_configuration_id);
CREATE INDEX IF NOT EXISTS "Asset_ninja_device_id_idx" ON "Asset" (ninja_device_id);

-- ---------------------------------------------------------------------------
-- 2. Organization — add MSP tenant columns
-- ---------------------------------------------------------------------------
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS controlmap_org_id text,
  ADD COLUMN IF NOT EXISTS tenant_tier text NOT NULL DEFAULT 'T1',
  ADD COLUMN IF NOT EXISTS client_company_id uuid;

-- Indexes for Organization MSP columns
CREATE INDEX IF NOT EXISTS "Organization_tenant_tier_idx" ON "Organization" (tenant_tier);
CREATE INDEX IF NOT EXISTS "Organization_client_company_id_idx" ON "Organization" (client_company_id);

-- ---------------------------------------------------------------------------
-- 3. TeamMember — add person link
--    person_id FK deferred to 004
-- ---------------------------------------------------------------------------
ALTER TABLE "TeamMember"
  ADD COLUMN IF NOT EXISTS person_id uuid;

CREATE INDEX IF NOT EXISTS "TeamMember_person_id_idx" ON "TeamMember" (person_id);

-- ---------------------------------------------------------------------------
-- 4. ReportFound — add anonymous/discreet mode
-- ---------------------------------------------------------------------------
ALTER TABLE "ReportFound"
  ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false;
