-- =============================================================================
-- 008_seed_data.sql
-- Seed default asset statuses and system roles
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Default asset status configurations
--    These are system-level defaults. Each organization gets a copy of these
--    when created. The is_system flag prevents deletion of core statuses.
--
--    Note: These are inserted with a well-known organization_id placeholder.
--    In practice, a function or trigger copies these to new organizations
--    on creation. For the seed, we use a sentinel org ID.
--
--    Alternatively, the application layer seeds these per-org on creation.
--    We provide a template function here.
-- ---------------------------------------------------------------------------

-- Template function: call this when creating a new organization to seed
-- its default asset statuses
CREATE OR REPLACE FUNCTION seed_default_asset_statuses(p_org_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO asset_status_config (organization_id, name, color, icon, is_default, sort_order, is_system)
  VALUES
    (p_org_id, 'Available',       '#22C55E', 'check-circle',    true,  0, true),
    (p_org_id, 'In Use',          '#3B82F6', 'user',            false, 1, true),
    (p_org_id, 'In Repair',       '#F59E0B', 'wrench',          false, 2, true),
    (p_org_id, 'In Transit',      '#8B5CF6', 'truck',           false, 3, true),
    (p_org_id, 'In Storage',      '#6B7280', 'archive',         false, 4, true),
    (p_org_id, 'Decommissioned',  '#EF4444', 'x-circle',        false, 5, true),
    (p_org_id, 'Lost',            '#DC2626', 'alert-triangle',   false, 6, true),
    (p_org_id, 'Stolen',          '#991B1B', 'shield-alert',     false, 7, true),
    (p_org_id, 'For Collection',  '#0EA5E9', 'package',          false, 8, true)
  ON CONFLICT (organization_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 2. System roles
--    Ensure the base roles exist in the Role table
-- ---------------------------------------------------------------------------
INSERT INTO "Role" (name)
VALUES ('USER'), ('ADMIN')
ON CONFLICT (name) DO NOTHING;
